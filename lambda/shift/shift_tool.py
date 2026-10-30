#!/usr/bin/env python3
"""山本農園 シフト調整ツール（timetreeの勤務希望 → CSV → 調整目安）

使い方（詳しくは README.md）:
  python shift_tool.py fetch  ics_dir                       # timetreeから.icsを取得（要 timetree-exporter）
  python shift_tool.py parse  ics_dir --month 2026-11       # .ics → 勤務希望CSV
  python shift_tool.py plan   entries_2026-11.csv           # CSV → 調整目安
  python shift_tool.py all    ics_dir --month 2026-11       # parse + plan
  python shift_tool.py kyugyo wages.csv --as-of 2026-11-15  # 休業手当のベース（平均賃金）
標準ライブラリのみで動きます（Python 3.9以上）。
"""
import argparse, csv, json, os, re, subprocess, sys, unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    JST = ZoneInfo("Asia/Tokyo")
except Exception:  # pragma: no cover
    JST = timezone(timedelta(hours=9))

WD = "月火水木金土日"
HERE = Path(__file__).resolve().parent


# ───────────────────────── 設定 ─────────────────────────
def load_config(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def hm(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def fmt_hm(minutes):
    return f"{minutes // 60}:{minutes % 60:02d}"


def fmt_dur(minutes):
    h, m = divmod(int(round(minutes)), 60)
    return f"{h}時間{m:02d}分" if m else f"{h}時間"


# ───────────────────────── ICS 読み込み ─────────────────────────
def unfold(text):
    lines = []
    for ln in text.splitlines():
        if ln[:1] in (" ", "\t") and lines:
            lines[-1] += ln[1:]
        else:
            lines.append(ln)
    return lines


def unesc(s):
    return (s.replace("\\n", "\n").replace("\\N", "\n")
             .replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\"))


def parse_props(lines):
    props = {}
    for ln in lines:
        if ":" not in ln:
            continue
        head, _, val = ln.partition(":")
        parts = head.split(";")
        params = {}
        for p in parts[1:]:
            k, _, v = p.partition("=")
            params[k.upper()] = v.strip('"')
        props.setdefault(parts[0].upper(), []).append((params, unesc(val)))
    return props


def parse_dt(params, val):
    """→ (date|datetime(JST), is_allday)"""
    val = val.strip()
    if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", val):
        return datetime.strptime(val[:8], "%Y%m%d").date(), True
    base = datetime.strptime(val.rstrip("Z")[:15], "%Y%m%dT%H%M%S")
    if val.endswith("Z"):
        return base.replace(tzinfo=timezone.utc).astimezone(JST), False
    tzid = params.get("TZID")
    if tzid:
        try:
            return base.replace(tzinfo=ZoneInfo(tzid)).astimezone(JST), False
        except Exception:
            pass
    return base.replace(tzinfo=JST), False


def read_ics(path):
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    events, cur = [], None
    for ln in unfold(text):
        u = ln.strip().upper()
        if u == "BEGIN:VEVENT":
            cur = []
        elif u == "END:VEVENT" and cur is not None:
            events.append(parse_props(cur))
            cur = None
        elif cur is not None:
            cur.append(ln)
    return events


# ───────────────────────── タイトル解釈 ─────────────────────────
TIME_RE = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*[-~]\s*(\d{1,2})(?::(\d{2}))?")
TIME_END_ONLY_RE = re.compile(r"[-~]\s*(\d{1,2})(?::(\d{2}))?")
TIME_START_ONLY_RE = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*[-~]")


def norm_title(s):
    s = unicodedata.normalize("NFKC", s).strip()
    for ch in "〜–—―−":
        s = s.replace(ch, "-" if ch != "〜" else "~")
    return s


def classify(title):
    """→ ('time', start_min, end_min) | ('time_end', end_min) | ('time_start', start_min)
         | ('AM',) | ('PM',) | ('ALLDAY',) | ('BLANK',) | ('UNKNOWN',) | None(希望ではない)"""
    t = norm_title(title)
    if not t.startswith("希"):
        return None
    r = t[1:].lstrip("望").strip(" :・")
    m = TIME_RE.search(r)
    if m:
        s = int(m.group(1)) * 60 + int(m.group(2) or 0)
        e = int(m.group(3)) * 60 + int(m.group(4) or 0)
        return ("time", s, e)
    m = TIME_END_ONLY_RE.search(r)   # 「~15:00」（開始なし）
    if m:
        return ("time_end", int(m.group(1)) * 60 + int(m.group(2) or 0))
    m = TIME_START_ONLY_RE.search(r)  # 「8:30~」（終了なし）
    if m:
        return ("time_start", int(m.group(1)) * 60 + int(m.group(2) or 0))
    ru = r.upper()
    if "終日" in r or "全日" in r:
        return ("ALLDAY",)
    if "AM" in ru or "午前" in r:
        return ("AM",)
    if "PM" in ru or "午後" in r:
        return ("PM",)
    if r == "":
        return ("BLANK",)
    return ("UNKNOWN",)


def break_for(start, end, cfg):
    spans = start < 720 < end
    b = cfg["break_minutes"]
    return b["spanning_noon"] if spans else b["not_spanning_noon"]


def fit_to_cap(known, missing, cap_min, cfg):
    """片側のみ指定でデフォルト補完が上限を超えるとき、欠けていた側を実働=cap_minに縮める。
    missing='start': 終了known固定で開始を遅らせる / 'end': 開始known固定で終了を早める。"""
    b = cfg["break_minutes"]
    s = e = None
    for brk in (b["spanning_noon"], b["not_spanning_noon"]):
        if missing == "start":
            s, e = known - cap_min - brk, known
        else:
            s, e = known, known + cap_min + brk
        if break_for(s, e, cfg) == brk:  # 休憩時間が正午またぎと整合するか
            return s, e
    return s, e


# ───────────────────────── parse ─────────────────────────
def match_staff(cfg, label_text, summary):
    for text in (label_text, summary):
        for s in cfg["staff"]:
            if any(k and k in text for k in s["match"]):
                return s
    return None


def cmd_parse(args):
    cfg = load_config(args.config)
    y, mth = map(int, args.month.split("-"))
    first = date(y, mth, 1)
    nxt = date(y + (mth == 12), mth % 12 + 1, 1)
    src = Path(args.ics)
    if not src.exists():
        sys.exit(f"{src} が見つかりません。")
    files = sorted(src.glob("*.ics")) if src.is_dir() else [src]
    if not files:
        sys.exit(f"{src} に .ics がありません。先に fetch を実行してください。")

    rows, notes = [], []
    seen = {}
    skipped_other = 0
    for f in files:
        for ev in read_ics(f):
            summary = ev.get("SUMMARY", [({}, "")])[0][1]
            label_bits = [f.stem]
            label_bits += [v for _, v in ev.get("CATEGORIES", [])]
            label_bits += [v for k, vs in ev.items() if k.startswith("X-") for _, v in vs]
            kind = classify(summary)
            if kind is not None and "RRULE" in ev:
                notes.append(f"繰り返し予定は展開していません: {summary}（{f.name}）")
            if "DTSTART" not in ev:
                continue
            sp, sv = ev["DTSTART"][0]
            start, allday = parse_dt(sp, sv)
            days = []
            if allday:
                end = start + timedelta(days=1)
                if "DTEND" in ev:
                    end, _ = parse_dt(*ev["DTEND"][0])
                    if isinstance(end, datetime):
                        end = end.date()
                n = 0
                d = start
                while d < max(end, start + timedelta(days=1)) and n < 31:
                    days.append((d, None, None)); d += timedelta(days=1); n += 1
            else:
                s_min = start.hour * 60 + start.minute
                e_min = None
                if "DTEND" in ev:
                    e, ae = parse_dt(*ev["DTEND"][0])
                    if isinstance(e, datetime) and e.date() == start.date():
                        e_min = e.hour * 60 + e.minute
                days.append((start.date(), s_min, e_min))

            if kind is None:
                if any(first <= d < nxt for d, _, _ in days):
                    skipped_other += 1
                continue
            staff = match_staff(cfg, " ".join(label_bits), summary)

            for d, ds, de in days:
                if not (first <= d < nxt):
                    continue
                warn = []
                person = staff["name"] if staff else "（不明）"
                if not staff:
                    warn.append("人を特定できません（ラベル/名前を確認）")
                k, start_m, end_m = kind[0], None, None
                auto_side = ""  # ツールが補完した側（"start"/"end"）。本人の希望ではない印
                if k == "time":
                    start_m, end_m = kind[1], kind[2]
                elif k == "time_end":
                    k = "time"
                    start_m, end_m = hm(cfg["allday_default"]["start"]), kind[1]
                    cap = cfg["peak_max_work_hours"] if args.peak else cfg["max_work_hours"]
                    cap_min = int(round(cap * 60))
                    if end_m - start_m - break_for(start_m, end_m, cfg) > cap_min:
                        start_m, end_m = fit_to_cap(end_m, "start", cap_min, cfg)
                    auto_side = "start"
                elif k == "time_start":
                    k = "time"
                    start_m, end_m = kind[1], hm(cfg["allday_default"]["end"])
                    cap = cfg["peak_max_work_hours"] if args.peak else cfg["max_work_hours"]
                    cap_min = int(round(cap * 60))
                    if end_m - start_m - break_for(start_m, end_m, cfg) > cap_min:
                        start_m, end_m = fit_to_cap(start_m, "end", cap_min, cfg)
                    auto_side = "end"
                elif k == "AM":
                    start_m, end_m = hm(cfg["am_default"]["start"]), hm(cfg["am_default"]["end"])
                elif k == "PM":
                    start_m, end_m = hm(cfg["pm_default"]["start"]), hm(cfg["pm_default"]["end"])
                elif k == "BLANK":
                    if ds is not None and de is not None:      # 開始・終了が予定側に入力されている
                        k, start_m, end_m = "time", ds, de
                        warn.append("タイトルに時間なし：予定の開始・終了時刻を使用")
                    else:
                        k = "ALLDAY"
                        warn.append("「希」のみ：終日として扱いました")
                elif k == "UNKNOWN":
                    warn.append("書き方を解釈できません（確認してください）")

                flexible = k in ("AM", "PM", "ALLDAY")
                brk, work = "", ""
                if k in ("time", "AM", "PM") and start_m is not None:
                    if end_m <= start_m:
                        warn.append("終了時刻が開始以前です")
                    else:
                        brk = break_for(start_m, end_m, cfg)
                        work = round((end_m - start_m - brk) / 60, 2)
                elif k == "ALLDAY":
                    work = cfg["flex_all_day_assumed_hours"]

                key = (person, d)
                if key in seen:
                    warn.append("同じ日に複数の希望があります（重複）")
                    rows[seen[key]]["warnings"] += " / 同じ日に複数の希望があります（重複）"
                seen.setdefault(key, len(rows))

                if work != "":
                    if work < cfg["min_work_hours"] and k == "time":
                        warn.append(f"実働{work}hは下限{cfg['min_work_hours']}h未満")
                    if work > cfg["max_work_hours"] and not args.peak:
                        warn.append(f"実働{work}hは上限{cfg['max_work_hours']}h超（繁忙期の同意が必要）")
                    if work > cfg["peak_max_work_hours"]:
                        warn.append(f"実働{work}hは繁忙期上限{cfg['peak_max_work_hours']}h超")
                if staff and k == "time":
                    le = staff.get("latest_end", {}).get(WD[d.weekday()])
                    if le and end_m is not None and end_m > hm(le):
                        warn.append(f"{WD[d.weekday()]}曜は{le}までの制約")
                if staff and d.day in staff.get("unavailable_days_of_month", []):
                    warn.append("入れない日（毎月の予定）に希望が入っています")

                rows.append({
                    "date": d.isoformat(), "weekday": WD[d.weekday()], "person": person,
                    "raw_title": summary, "kind": k,
                    "start": fmt_hm(start_m) if start_m is not None and k != "ALLDAY" else "",
                    "end": fmt_hm(end_m) if end_m is not None and k != "ALLDAY" else "",
                    "break_min": brk, "work_hours": work,
                    "flexible": int(flexible),
                    "fixed_weekday": int(bool(staff) and WD[d.weekday()] in staff.get("fixed_weekdays", [])),
                    "auto": auto_side,
                    "warnings": " / ".join(warn), "source": f.name,
                })

    rows.sort(key=lambda r: (r["date"], r["person"]))
    out = Path(args.output or f"entries_{args.month}.csv")
    cols = ["date", "weekday", "person", "raw_title", "kind", "start", "end", "break_min",
            "work_hours", "flexible", "fixed_weekday", "auto", "warnings", "source"]
    with open(out, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"{args.month}: 勤務希望 {len(rows)} 件 → {out}（「希」で始まらない予定 {skipped_other} 件は対象外）")
    for n in notes:
        print("  注意:", n)
    bad = [r for r in rows if r["warnings"]]
    if bad:
        print(f"  確認が必要な行: {len(bad)} 件（CSVの warnings 列を見てください）")
    return out


# ───────────────────────── plan ─────────────────────────
def read_entries(path):
    out = []
    with open(path, encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            if not r["date"]:
                continue
            r["d"] = date.fromisoformat(r["date"])
            wh = r.get("work_hours", "")
            r["min"] = int(round(float(wh) * 60)) if wh not in ("", None) else None
            r["fixed"] = r.get("fixed_weekday") in ("1", 1, "True", "true")
            out.append(r)
    return out


def total_min(entries, lu, lp, protected):
    return sum(min(e["min"], lp if e["person"] in protected else lu) for e in entries)


def solve(entries, target, protected, mn, mx, step=30):
    steps = list(range(mx, mn - 1, -step))
    if steps[-1] != mn:
        steps.append(mn)
    for lu in steps:
        if total_min(entries, lu, mx, protected) <= target:
            return lu, mx
    for lp in steps:
        if total_min(entries, mn, lp, protected) <= target:
            return mn, lp
    return None


def proposed_end(e, new_min, cfg):
    """時間指定の希望を new_min 分に短縮したときの終了時刻"""
    if e["kind"] not in ("time", "AM", "PM") or not e["start"]:
        return ""
    s = hm(e["start"])
    for b in (cfg["break_minutes"]["not_spanning_noon"], cfg["break_minutes"]["spanning_noon"]):
        end = s + new_min + b
        if break_for(s, end, cfg) == b:
            return fmt_hm(end)
    return ""


def pay(entries_by_person, cfg, hours_of):
    total = 0
    for p, es in entries_by_person.items():
        hourly = next((s.get("hourly", cfg["base_hourly"]) for s in cfg["staff"] if s["name"] == p),
                      cfg["base_hourly"])
        mins = sum(hours_of(e) for e in es)
        total += mins / 60 * hourly + min(len(es) * cfg["commute"]["per_day"], cfg["commute"]["monthly_cap"])
    return int(round(total))


def build_confirm_plan(valid, cfg, protected, mn, mx, target_min, budget_max):
    """確定の目安（デフォルトモード）の計算本体。表示はせず結果データを返す。
    budget_max: 人件費の予算上限（円）。超える場合は第6条の順番で調整する。"""
    fixed_e = [e for e in valid if e["fixed"]]
    extra_e = [e for e in valid if not e["fixed"]]
    fixed_min = sum(e["min"] for e in fixed_e)
    extra_min = sum(e["min"] for e in extra_e)
    lu_f = lp_f = mx
    fixed_solve_failed = False
    if fixed_min > target_min:
        sol = solve(fixed_e, target_min, protected, mn, mx)
        fixed_solve_failed = sol is None
        lu_f, lp_f = sol if sol else (mn, mn)
    fixed_after = total_min(fixed_e, lu_f, lp_f, protected)
    hour_budget = max(0, target_min - fixed_after)

    hc = Counter(e["date"] for e in fixed_e)
    got = Counter()
    left = list(extra_e)
    confirm = []
    left_budget = hour_budget
    # 週上限・連勤上限のチェック用（決まった曜日＋確定済みで数える）
    wk_cnt = Counter()
    day_set = defaultdict(set)
    for e in fixed_e:
        wk_cnt[(e["person"], e["d"] - timedelta(days=e["d"].weekday()))] += 1
        day_set[e["person"]].add(e["d"])

    def rule_block(e):
        """週上限・連勤上限に当たる場合は理由を返す（当たらなければNone）"""
        p, d = e["person"], e["d"]
        if wk_cnt[(p, d - timedelta(days=d.weekday()))] >= cfg["weekly_max_days"]:
            return f"週{cfg['weekly_max_days']}日の上限"
        run, x = 1, d - timedelta(days=1)
        while x in day_set[p]:
            run += 1; x -= timedelta(days=1)
        x = d + timedelta(days=1)
        while x in day_set[p]:
            run += 1; x += timedelta(days=1)
        if run > cfg["consecutive_max_days"]:
            return f"連続{cfg['consecutive_max_days']}日の上限"
        return None

    while left:
        left.sort(key=lambda e: (e["person"] not in protected, hc[e["date"]], got[e["person"]], e["date"]))
        pick = None
        for e in left:
            if "入れない日" in e["warnings"]:
                continue
            if rule_block(e):
                continue
            if e["min"] <= left_budget:
                pick = (e, e["min"]); break
            if left_budget >= mn:
                pick = (e, left_budget); break
        if not pick:
            break
        e, give = pick
        confirm.append((e, give))
        left.remove(e)
        hc[e["date"]] += 1
        got[e["person"]] += 1
        wk_cnt[(e["person"], e["d"] - timedelta(days=e["d"].weekday()))] += 1
        day_set[e["person"]].add(e["d"])
        left_budget -= give

    # 予算（金額）超過の調整：第6条の順番（① 1日の時間を短く → ② 追加の希望日を保留）
    # ①の短縮は「追加の希望日（優先以外→優先）→ 決まった曜日（優先以外→優先）」の順で、
    # 決まった曜日の時間（基本の時間帯）をできるだけ守る。
    TIERS = ["extra_others", "extra_protected", "fixed_others", "fixed_protected"]

    def tier_of(e, fixed):
        prot = e["person"] in protected
        return ("fixed_" if fixed else "extra_") + ("protected" if prot else "others")

    def plan_cost(caps):
        """階層別の時間上限 caps（分）を当てはめたときの人件費（交通費込み）"""
        nb2 = defaultdict(list)
        for e in fixed_e:
            base_cap = lp_f if e["person"] in protected else lu_f
            nb2[e["person"]].append(min(e["min"], base_cap, caps[tier_of(e, True)]))
        for e, give in confirm:
            nb2[e["person"]].append(min(give, caps[tier_of(e, False)]))
        total = 0
        for pn, mins in nb2.items():
            hourly = next((s.get("hourly", cfg["base_hourly"]) for s in cfg["staff"] if s["name"] == pn),
                          cfg["base_hourly"])
            total += sum(mins) / 60 * hourly + min(len(mins) * cfg["commute"]["per_day"], cfg["commute"]["monthly_cap"])
        return total

    def fit_budget(step=30):
        """予算上限に収まる最小限の短縮を、階層順（追加→決まった曜日）に探す"""
        steps = list(range(mx, mn - 1, -step))
        if steps[-1] != mn:
            steps.append(mn)
        caps = {name: mx for name in TIERS}
        for name in TIERS:
            for cap in steps:
                caps[name] = cap
                if plan_cost(caps) <= budget_max:
                    return caps
            caps[name] = mn
        return None

    caps = {name: mx for name in TIERS}
    budget_dropped = []
    budget_over = plan_cost(caps) > budget_max
    if budget_over:
        while True:
            sol_b = fit_budget()
            if sol_b:
                caps = sol_b
                break
            cands = [c for c in confirm if c[0]["person"] not in protected] or confirm
            if not cands:
                caps = {name: mn for name in TIERS}
                break
            gotc = Counter(e["person"] for e, _ in confirm)
            pe = max(cands, key=lambda c: (gotc[c[0]["person"]], hc[c[0]["date"]], c[0]["date"]))
            confirm.remove(pe)
            budget_dropped.append(pe[0])
            left.append(pe[0])
            hc[pe[0]["date"]] -= 1
            wk_cnt[(pe[0]["person"], pe[0]["d"] - timedelta(days=pe[0]["d"].weekday()))] -= 1
            day_set[pe[0]["person"]].discard(pe[0]["d"])
        confirm = [(e, min(give, caps[tier_of(e, False)])) for e, give in confirm]
    still_over = plan_cost(caps) > budget_max

    bd_ids = {id(e) for e in budget_dropped}
    hold_reason = {}
    for e in left:
        if "入れない日" in e["warnings"]:
            hold_reason[id(e)] = "入れない日の希望：要確認"
        elif id(e) in bd_ids:
            hold_reason[id(e)] = "予算の上限のため保留"
        else:
            reason = rule_block(e)
            if reason:
                hold_reason[id(e)] = f"{reason}のため保留"

    # 人別の割り当て（確定の目安ベース）と人件費
    assigned = defaultdict(list)
    for e in fixed_e:
        base_cap = lp_f if e["person"] in protected else lu_f
        assigned[e["person"]].append((e, min(e["min"], base_cap, caps[tier_of(e, True)])))
    for e, give in confirm:
        assigned[e["person"]].append((e, give))
    per_cost, total_pay = {}, 0.0
    for pn, items in assigned.items():
        hourly = next((s.get("hourly", cfg["base_hourly"]) for s in cfg["staff"] if s["name"] == pn), cfg["base_hourly"])
        c = sum(m_ for _, m_ in items) / 60 * hourly + min(len(items) * cfg["commute"]["per_day"], cfg["commute"]["monthly_cap"])
        per_cost[pn] = int(round(c))
        total_pay += c

    return {
        "budget_max": budget_max,
        "fixed_e": fixed_e, "extra_e": extra_e,
        "fixed_min": fixed_min, "extra_min": extra_min,
        "lu_f": lu_f, "lp_f": lp_f, "fixed_solve_failed": fixed_solve_failed,
        "fixed_after": fixed_after, "hour_budget": hour_budget,
        "confirm": confirm, "left": left,
        "caps": caps,
        "budget_over": budget_over, "budget_dropped": budget_dropped, "bd_ids": bd_ids,
        "still_over": still_over, "hold_reason": hold_reason,
        "assigned": assigned, "per_cost": per_cost, "cost": int(round(total_pay)),
    }


def proposal_rows(r, cfg, protected):
    """build_confirm_plan の結果から proposal 行（CSV/JSON共通）を作る"""
    rows = []
    for e in r["fixed_e"]:
        prot = e["person"] in protected
        base_cap = r["lp_f"] if prot else r["lu_f"]
        newm = min(e["min"], base_cap, r["caps"]["fixed_protected" if prot else "fixed_others"])
        rows.append({
            "date": e["date"], "weekday": e["weekday"], "person": e["person"], "raw_title": e["raw_title"],
            "request_hours": round(e["min"] / 60, 2), "proposed_hours": round(newm / 60, 2),
            "proposed_end": proposed_end(e, newm, cfg) if newm < e["min"] else e["end"],
            "action": "確定・短縮（決まった曜日）" if newm < e["min"] else "確定（決まった曜日）",
            "fixed_weekday": 1, "reason": ""})
    for e, give in r["confirm"]:
        rows.append({
            "date": e["date"], "weekday": e["weekday"], "person": e["person"], "raw_title": e["raw_title"],
            "request_hours": round(e["min"] / 60, 2), "proposed_hours": round(give / 60, 2),
            "proposed_end": proposed_end(e, give, cfg) if give < e["min"] else e["end"],
            "action": "確定の目安（追加）", "fixed_weekday": 0, "reason": ""})
    for e in r["left"]:
        rows.append({
            "date": e["date"], "weekday": e["weekday"], "person": e["person"], "raw_title": e["raw_title"],
            "request_hours": round(e["min"] / 60, 2), "proposed_hours": 0, "proposed_end": "",
            "action": "保留・見送り候補（予算）" if id(e) in r["bd_ids"] else "保留・見送り候補（追加）",
            "fixed_weekday": 0, "reason": r["hold_reason"].get(id(e), "")})
    return rows


def cmd_plan(args):
    cfg = load_config(args.config)
    entries = read_entries(args.entries)
    if not entries:
        sys.exit("勤務希望がありません。")
    month = entries[0]["date"][:7]
    y, mth = map(int, month.split("-"))
    first = date(y, mth, 1)
    last = date(y + (mth == 12), mth % 12 + 1, 1) - timedelta(days=1)

    mn = int(round(cfg["min_work_hours"] * 60))
    mx = int(round((cfg["peak_max_work_hours"] if args.peak else cfg["max_work_hours"]) * 60))
    tpd = dict(cfg["target_person_days"])
    if args.target_person_days:
        tpd["center"] = tpd["max"] = args.target_person_days
    target_min = int(round(tpd["center"] * cfg["hours_per_day_target"] * 60))
    protected = {s["name"] for s in cfg["staff"] if s.get("protected")}
    staff_names = [s["name"] for s in cfg["staff"]]

    # 計算に使う行（時間が分かるもの）
    valid = [e for e in entries if e["min"] is not None]
    unknown = [e for e in entries if e["min"] is None]
    by_person = defaultdict(list)
    for e in valid:
        by_person[e["person"]].append(e)

    L = []
    P = L.append
    P(f"■ {month} シフト調整の目安（勤務希望 {len(entries)} 件）")
    P(f"  目標: {tpd['min']}〜{tpd['max']}人日（中心{tpd['center']}）／ {target_min/60:g}人時（{tpd['center']}日×{cfg['hours_per_day_target']}h）")
    P("")

    # 1) 人別
    P("【1】人別の希望")
    P(f"  {'名前':<6}{'希望日数':>6}{'(決曜日':>7}{'+追加)':>6}{'目安日数':>8}{'差':>5}{'人時':>8}")
    td = th = 0
    for name in staff_names + sorted(set(by_person) - set(staff_names)):
        es = by_person.get(name, [])
        st = next((s for s in cfg["staff"] if s["name"] == name), {})
        days = len(es)
        fx = sum(e["fixed"] for e in es)
        tgt = st.get("target_days")
        hrs = sum(e["min"] for e in es) / 60
        td += days; th += hrs
        diff = "" if tgt is None else f"{days - tgt:+d}"
        flag = "  ← 未入力" if days == 0 and name in staff_names else ""
        P(f"  {name:<6}{days:>6}{fx:>8}{days - fx:>6}{(tgt if tgt is not None else '-'):>8}{diff:>5}{hrs:>8.1f}{flag}")
    P(f"  {'合計':<6}{td:>6}{'':>8}{'':>6}{'':>8}{'':>5}{th:>8.1f}")
    P("")

    # 2) 全体との比較
    P("【2】全体との比較")
    dd = td - tpd["center"]
    P(f"  人日: {td}（目標 {tpd['min']}〜{tpd['max']}）→ " +
      ("範囲内" if tpd["min"] <= td <= tpd["max"] else f"範囲外（{'超過' if td > tpd['max'] else '不足'}）"))
    ov = sum(e["min"] for e in valid) - target_min
    P(f"  人時: {th:.1f}h（目標 {target_min/60:g}h）→ " +
      (f"{ov/60:.1f}h 超過" if ov > 0 else f"{-ov/60:.1f}h 余裕"))
    cost = pay(by_person, cfg, lambda e: e["min"])
    b = cfg["labor_budget_yen"]
    P(f"  人件費（希望どおりの試算・交通費込み）: {cost:,}円（予算 {b['min']:,}〜{b['max']:,}円）→ " +
      ("予算内" if cost <= b["max"] else f"{cost - b['max']:,}円 超過"))
    P("  ※時給は config.json の staff.hourly（評価の加算を含む）で計算します。")
    P("")

    # 3) 日別人数
    P("【3】日別の人数（人が多い日・少ない日）")
    heads = defaultdict(list)
    for e in valid:
        heads[e["d"]].append(e["person"])
    d = first
    line = []
    while d <= last:
        n = len(heads.get(d, []))
        line.append(f"{d.day:>2}({WD[d.weekday()]}){n}")
        d += timedelta(days=1)
    for i in range(0, len(line), 7):
        P("  " + "  ".join(line[i:i + 7]))
    zero = [f"{d.day}日" for d in (first + timedelta(days=i) for i in range((last - first).days + 1))
            if len(heads.get(d, [])) == 0]
    if zero:
        P("  希望がない日: " + "、".join(zero))
    P("")

    # 4) チェック
    P("【4】ルールのチェック")
    issues = []
    for name, es in by_person.items():
        days = sorted(e["d"] for e in es)
        wk = Counter(d - timedelta(days=d.weekday()) for d in days)
        for ws, n in sorted(wk.items()):
            if n > cfg["weekly_max_days"]:
                issues.append(f"{name}: {ws.month}/{ws.day}の週に{n}日（週{cfg['weekly_max_days']}日以内）")
        run = 1
        for a, b2 in zip(days, days[1:]):
            run = run + 1 if (b2 - a).days == 1 else 1
            if run == cfg["consecutive_max_days"] + 1:
                issues.append(f"{name}: {b2.month}/{b2.day}で{run}連勤（連続{cfg['consecutive_max_days']}日以内）")
    for st in cfg["staff"]:
        fw = st.get("fixed_weekdays", [])
        if len(fw) < 2:
            issues.append(f"{st['name']}: 決まった曜日が{len(fw)}日です（通知書は週2〜3日）。config.json の fixed_weekdays を確認してください")
        else:
            have = {e["d"] for e in by_person.get(st["name"], [])}
            miss, d = [], first
            while d <= last:
                if WD[d.weekday()] in fw and d not in have and d.day not in st.get("unavailable_days_of_month", []):
                    miss.append(f"{d.month}/{d.day}")
                d += timedelta(days=1)
            if miss:
                issues.append(f"{st['name']}: 決まった曜日の入力がない日（休みとして扱います）: " + "、".join(miss))
    for e in entries:
        if e["warnings"]:
            issues.append(f"{e['d'].month}/{e['d'].day}({e['weekday']}) {e['person']}「{e['raw_title']}」: {e['warnings']}")
    if unknown:
        issues.append(f"時間が計算できない希望が {len(unknown)} 件あります（計算から除外）")
    for x in issues or ["問題は見つかりませんでした"]:
        P("  ・" + x)
    P("")

    if args.mode == "all":
        # 5) 調整の目安（第6条の順番）
        P("【5】調整の目安（第6条の順番：①1日の時間を短く → ②追加で希望された日を減らす）")
        proposal = []
        result = solve(valid, target_min, protected, mn, mx)
        removed = []
        cur = list(valid)
        if ov <= 0:
            P("  希望どおりに確定できます（人時が目標内）。")
            if td > tpd["max"]:
                P(f"  ※人日は{td}日で上限{tpd['max']}日を超えていますが、時間で収まっています。")
            else:
                P(f"  ※目標まであと {-ov/60:.1f}人時 の余裕があります。人の少ない日に追加をお願いできます。")
            lu = lp = mx
        else:
            while solve(cur, target_min, protected, mn, mx) is None:
                cands = [e for e in cur if not e["fixed"]]
                if not cands:
                    break
                hc = Counter(e["date"] for e in cur)
                ex = Counter(e["person"] for e in cur if not e["fixed"])
                pick = max(cands, key=lambda e: (e["person"] not in protected, ex[e["person"]], hc[e["date"]], e["date"]))
                removed.append(pick)
                cur.remove(pick)
            sol = solve(cur, target_min, protected, mn, mx)
            if sol is None:
                lu = lp = mn
                P(f"  ※追加の希望日をすべて減らしても、決まった曜日だけで {(total_min(cur, mn, mn, protected) - target_min)/60:.1f}人時 超えます。")
                P("    決まった曜日の削減が必要です（本人と相談し、同意を得て行います）。")
            else:
                lu, lp = sol
            P(f"  超過 {ov/60:.1f}人時 を調整します。")
            if not removed:
                P("  ① 1日の時間を短くするだけで収まります。")
            else:
                P(f"  ① 1日の時間を下限{mn/60:g}hまで短くしても収まらないため、② 追加希望日 {len(removed)} 日を減らす案です。")
            if lu < mx and lp == mx:
                P(f"    → 優先する人（{'・'.join(sorted(protected))}）以外は、1日の実働を {fmt_dur(lu)} 以内に（長い日から短く）。")
            elif lp < mx:
                P(f"    → 優先する人（{'・'.join(sorted(protected))}）も含め、1日の実働を {fmt_dur(lp)} 以内に。他の人は下限の {fmt_dur(mn)}。")
            P(f"  案の人時: {total_min(cur, lu, lp, protected)/60:.1f}h（目標 {target_min/60:g}h）／ 案の人日: {len(cur)}日")
            if len(cur) > tpd["max"]:
                P(f"  ※人日は{len(cur)}日で上限{tpd['max']}日を超えますが、時間で収まるため、希望日はなるべく減らさない方針です。")
        rem_ids = {id(e) for e in removed}
        for e in valid:
            if id(e) in rem_ids:
                act, newm = "削除候補", 0
            else:
                cap = lp if e["person"] in protected else lu
                newm = min(e["min"], cap)
                act = "短縮" if newm < e["min"] else "そのまま"
            proposal.append({
                "date": e["date"], "weekday": e["weekday"], "person": e["person"], "raw_title": e["raw_title"],
                "request_hours": round(e["min"] / 60, 2), "proposed_hours": round(newm / 60, 2),
                "proposed_end": proposed_end(e, newm, cfg) if act == "短縮" else (e["end"] if act == "そのまま" else ""),
                "action": act, "fixed_weekday": int(e["fixed"]),
            })
        P("")
        if removed:
            P("  【減らす候補の日（追加希望）】")
            for e in sorted(removed, key=lambda e: (e["person"], e["d"])):
                P(f"    {e['person']} {e['d'].month}/{e['d'].day}({e['weekday']}) 「{e['raw_title']}」")
            P("")
        short = [p for p in proposal if p["action"] == "短縮"]
        if short:
            P(f"  【短縮する日】{len(short)} 件（詳細は proposal CSV）")
            by = Counter(p["person"] for p in short)
            P("    " + "、".join(f"{k} {v}日" for k, v in by.items()))
            P("")
        keep = [e for e in valid if id(e) not in rem_ids]
        nb = defaultdict(list)
        for e in keep:
            nb[e["person"]].append(e)
        after = pay(nb, cfg, lambda e: min(e["min"], lp if e["person"] in protected else lu))
        P(f"  案の人件費（交通費込み）: {after:,}円（予算 {b['min']:,}〜{b['max']:,}円）")
        P("")
        P("※これは目安です。実際の確定は、事情（作業の必要性・評価・制約）を見て、Excelで調整してください。")
        P("※時間の短縮は前日までに知らせ、本人の了承を得ます。")
    else:
        P("【5】確定の目安（決まった曜日は月末に確定／追加の希望日は「希」のまま、勤務日の3日前までに確定）")
        r = build_confirm_plan(valid, cfg, protected, mn, mx, target_min, b["max"])
        confirm, left = r["confirm"], r["left"]
        P(f"  決まった曜日: {len(r['fixed_e'])}日 / {r['fixed_min']/60:.1f}h → 月末に確定します")
        P(f"  追加の希望日: {len(r['extra_e'])}日 / {r['extra_min']/60:.1f}h → 「希」のまま（勤務日の3日前までに確定または見送り）")
        if r["fixed_min"] > target_min:
            P(f"  ※決まった曜日だけで目標を {(r['fixed_min'] - target_min)/60:.1f}h 超えます。第6条①のとおり、1日の時間を短くする必要があります。")
            if r["fixed_solve_failed"]:
                P("    下限まで短くしても収まりません。決まった曜日の見直しを、本人と相談してください。")
        P(f"  追加で確定できる人時の目安: {r['hour_budget']/60:.1f}h（目標 {target_min/60:g}h − 決まった曜日 {r['fixed_after']/60:.1f}h）")
        P("")
        if r["budget_over"]:
            P(f"  ※案の人件費が予算上限 {b['max']:,}円 を超えるため、第6条の順番で調整しました:")
            tier_labels = [("extra_others", "追加の希望日（優先する人以外）"),
                           ("extra_protected", "追加の希望日（優先する人）"),
                           ("fixed_others", "決まった曜日（優先する人以外）"),
                           ("fixed_protected", "決まった曜日（優先する人）")]
            cut = [f"{label}を {fmt_dur(r['caps'][key])} 以内" for key, label in tier_labels if r["caps"][key] < mx]
            if cut:
                P("    ① " + "、".join(cut) + " に短縮します（追加の希望日から先に短縮し、決まった曜日の時間を守ります）。")
            if r["budget_dropped"]:
                P(f"    ② 追加の希望日 {len(r['budget_dropped'])}日 を保留・見送りにします。")
            if r["still_over"]:
                P("    ※下限まで短くし、追加の希望日をすべて保留にしても収まりません。決まった曜日の削減を、本人と相談してください（要同意）。")
            P("")
        P("  【追加の希望日：確定の目安】（人が少ない日・確定が少ない人を優先）")
        for e, give in sorted(confirm, key=lambda x: (x[0]["date"], x[0]["person"])):
            note = "" if give == e["min"] else f"（{fmt_dur(give)}に短縮）"
            P(f"    {e['d'].month}/{e['d'].day}({e['weekday']}) {e['person']} 「{e['raw_title']}」 → 確定の目安 {fmt_dur(give)}{note}")
        if not confirm:
            P("    （確定できる追加の希望日はありません）")
        P("")
        P("  【保留・見送りの候補】（作業量が決まってから、3日前までに判断）")
        for e in sorted(left, key=lambda e: (e["date"], e["person"])):
            reason = r["hold_reason"].get(id(e), "")
            note = f"（{reason}）" if reason else ""
            P(f"    {e['d'].month}/{e['d'].day}({e['weekday']}) {e['person']} 「{e['raw_title']}」{note}")
        if not left:
            P("    （なし）")
        P("")
        proj = Counter(e["person"] for e in r["fixed_e"])
        for e, _ in confirm:
            proj[e["person"]] += 1
        P("  人別の予定日数（決まった曜日＋確定の目安）: " + " / ".join(
            f"{n} {proj.get(n, 0)}日" for n in staff_names))
        proposal = proposal_rows(r, cfg, protected)
        P("")
        P(f"  案の人件費（交通費込み）: {r['cost']:,}円（予算 {b['min']:,}〜{b['max']:,}円）")
        P("")
        P("※これは目安です。実際の確定は、作業の必要性・評価・制約を見て、Excelで調整してください。")
        P("※追加の希望日は、確定の連絡がない日は勤務日ではありません。確定した日を農園の都合で中止する場合は、休業手当が必要です。")

    text = "\n".join(L)
    print(text)
    base = Path(args.entries).with_name(f"plan_{month}")
    Path(str(base) + ".txt").write_text(text + "\n", encoding="utf-8")
    pcols = ["date", "weekday", "person", "raw_title", "request_hours", "proposed_hours",
             "proposed_end", "action", "fixed_weekday", "reason"]
    with open(str(base).replace("plan_", "proposal_") + ".csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=pcols)
        w.writeheader()
        w.writerows(sorted(proposal, key=lambda p: (p["date"], p["person"])))
    saved = f"\n→ {base}.txt / {str(base).replace('plan_', 'proposal_')}.csv を保存しました"

    # 予算シナリオ付きJSON（農園OSの管理ページ用）。--mode all では出力しない。
    if args.mode != "all":
        hi_r = build_confirm_plan(valid, cfg, protected, mn, mx, target_min, float("inf"))
        lo_r = build_confirm_plan(valid, cfg, protected, mn, mx, target_min, 0)
        step = 10000
        lo = (lo_r["cost"] // step) * step
        hi = -(-hi_r["cost"] // step) * step
        budgets = sorted(set(range(lo, hi + step, step)) | {b["max"]})
        scenarios = []
        for bm in budgets:
            rr = r if bm == b["max"] else build_confirm_plan(valid, cfg, protected, mn, mx, target_min, bm)
            proj2 = Counter(e["person"] for e in rr["fixed_e"])
            for e, _ in rr["confirm"]:
                proj2[e["person"]] += 1
            scenarios.append({
                "budget_max": bm,
                "cost": rr["cost"],
                "within_budget": not rr["still_over"],
                "caps_hours": {
                    "extra_others": round(rr["caps"]["extra_others"] / 60, 2),
                    "extra_protected": round(rr["caps"]["extra_protected"] / 60, 2),
                    "fixed_others": round(min(rr["lu_f"], rr["caps"]["fixed_others"]) / 60, 2),
                    "fixed_protected": round(min(rr["lp_f"], rr["caps"]["fixed_protected"]) / 60, 2),
                },
                "adjusted_for_budget": rr["budget_over"],
                "held_for_budget_days": len(rr["budget_dropped"]),
                "needs_fixed_weekday_consult": rr["still_over"],
                "per_person_days": {n: proj2.get(n, 0) for n in staff_names},
                "per_person_cost": {n: rr["per_cost"].get(n, 0) for n in staff_names},
                "items": proposal_rows(rr, cfg, protected),
            })
        plan_json = {
            "month": month,
            "generated_at": datetime.now(JST).isoformat(timespec="seconds"),
            "targets": {
                "person_days": tpd,
                "hours_per_day": cfg["hours_per_day_target"],
                "person_hours": round(target_min / 60, 2),
                "labor_budget_yen": b,
                "min_work_hours": round(mn / 60, 2),
                "max_work_hours": round(mx / 60, 2),
                "commute": cfg["commute"],
                "base_hourly": cfg["base_hourly"],
                "allday_default": cfg["allday_default"],
                "break_minutes": cfg["break_minutes"],
                "weekly_max_days": cfg["weekly_max_days"],
            },
            "staff": [{"name": s["name"], "fixed_weekdays": s.get("fixed_weekdays", []),
                       "target_days": s.get("target_days"), "protected": bool(s.get("protected")),
                       "hourly": s.get("hourly", cfg["base_hourly"]),
                       "latest_end": s.get("latest_end", {}),
                       "unavailable_days_of_month": s.get("unavailable_days_of_month", [])}
                      for s in cfg["staff"]],
            "requests": {
                "entries": len(entries),
                "unknown_time": len(unknown),
                "person_days": td,
                "person_hours": round(th, 1),
                "cost_as_requested": cost,
                "daily_headcount": {d_.isoformat(): sorted(ps) for d_, ps in sorted(heads.items())},
                "no_request_days": [(first + timedelta(days=i)).isoformat()
                                    for i in range((last - first).days + 1)
                                    if not heads.get(first + timedelta(days=i))],
                # timetreeの希望の原本（時間が計算できないものも含む全件）
                "items": [{
                    "date": e["date"], "weekday": e["weekday"], "person": e["person"],
                    "raw_title": e["raw_title"], "kind": e["kind"],
                    "start": e.get("start", ""), "end": e.get("end", ""),
                    "work_hours": e.get("work_hours", ""),
                    "fixed_weekday": int(e["fixed"]), "auto": e.get("auto", ""),
                    "warnings": e.get("warnings", ""),
                } for e in entries],
            },
            "issues": issues,
            "default_budget_max": b["max"],
            "scenarios": scenarios,
        }
        Path(str(base) + ".json").write_text(json.dumps(plan_json, ensure_ascii=False, indent=1) + "\n",
                                             encoding="utf-8")
        saved += f"\n→ {base}.json を保存しました（予算シナリオ {len(scenarios)}件: {lo:,}〜{hi:,}円）"
    print(saved)


# ───────────────────────── kyugyo（休業手当のベース） ─────────────────────────
def month_days(y, m):
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - date(y, m, 1)).days


def cmd_kyugyo(args):
    """直近3か月の賃金から、平均賃金・休業手当（1日あたり）・追加不要になる実働時間の目安を出す。
    賃金CSV: month(YYYY-MM), person, total_pay(通勤手当込みの支給総額), work_days(その月の労働日数)"""
    cfg = load_config(args.config)
    as_of = date.fromisoformat(args.as_of)
    # 算定事由発生日（休業日）の直前の賃金締切日（末日）以前の3か月
    y, m = as_of.year, as_of.month
    months = []
    for _ in range(3):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        months.append(f"{y}-{m:02d}")
    months.sort()
    cal = sum(month_days(int(x[:4]), int(x[5:])) for x in months)

    data = defaultdict(dict)
    with open(args.wages, encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            data[r["person"]][r["month"]] = (float(r["total_pay"]), int(r["work_days"]))

    L = []
    P = L.append
    P(f"■ 休業手当のベース（休業日 {as_of}／算定期間 {months[0]}〜{months[-1]}、暦日数 {cal}日）")
    P("  平均賃金 ＝ ①賃金総額÷暦日数 と ②賃金総額÷労働日数×60%（最低保障）のうち高いほう")
    P("  休業手当 ＝ 平均賃金 × 60%（1日あたり）")
    P("")
    P(f"  {'名前':<6}{'賃金総額':>10}{'労働日数':>6}{'①':>8}{'②':>8}{'平均賃金':>9}{'休業手当':>9}{'追加不要の実働':>14}")
    for st in cfg["staff"]:
        name = st["name"]
        rows = data.get(name, {})
        got = [mm for mm in months if mm in rows]
        if not got:
            P(f"  {name:<6}  賃金データがありません")
            continue
        total = sum(rows[mm][0] for mm in got)
        days = sum(rows[mm][1] for mm in got)
        # 3か月に満たない場合は、データのある期間の暦日数で計算
        cdays = sum(month_days(int(x[:4]), int(x[5:])) for x in got)
        a = total / cdays
        b = total / days * 0.6 if days else 0
        avg = max(a, b)
        kyu = avg * 0.6
        hourly = st.get("hourly", cfg["base_hourly"])
        thr = kyu / hourly
        note = "" if len(got) == 3 else f"  ※{len(got)}か月分のみ"
        P(f"  {name:<6}{total:>10,.0f}{days:>6}{a:>8,.0f}{b:>8,.0f}{avg:>9,.0f}{kyu:>9,.0f}{fmt_dur(thr * 60):>14}{note}")
        if args.hours is not None:
            pay_ = args.hours * hourly
            diff = max(0, kyu - pay_)
            P(f"        → 実働{args.hours:g}時間（賃金{pay_:,.0f}円）なら、休業手当の追加は " +
              (f"{diff:,.0f}円" if diff > 0 else "不要"))
    P("")
    P("※全日休業の場合は、休業手当の額がそのまま必要です（天候等の不可抗力は対象外）。")
    P("※一部休業（時間短縮）は、その日の賃金が休業手当の額に届かないときだけ、差額が必要です。")
    P("※平均賃金は、休業日の直前の賃金締切日（末日）以前3か月で計算します。通勤手当は賃金総額に含めます。")
    P("※目安です。正確な扱いは、社労士に確認してください。")
    print("\n".join(L))


# ───────────────────────── fetch ─────────────────────────
def cmd_fetch(args):
    """timetree-exporter でラベル別の.icsを書き出す"""
    cfg = load_config(args.config)
    email = os.environ.get("TIMETREE_EMAIL") or cfg.get("timetree_email")
    password = os.environ.get("TIMETREE_PASSWORD") or cfg.get("timetree_password")
    if not (email and password):
        sys.exit("config.json の timetree_email / timetree_password を設定してください（README参照）。")
    os.environ["TIMETREE_EMAIL"] = email
    os.environ["TIMETREE_PASSWORD"] = password
    out = Path(args.ics)
    out.mkdir(parents=True, exist_ok=True)
    cmd = ["timetree-exporter", "-o", str(out / "timetree.ics"), "--split-by-label"]
    code = args.calendar_code or cfg.get("timetree_calendar_code")
    if code:
        cmd += ["-c", code]
    print("実行:", " ".join(cmd))
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        sys.exit("timetree-exporter が見つかりません。 pip install timetree-exporter を実行してください。")
    print(f"→ {out} に .ics を保存しました")


def main():
    ap = argparse.ArgumentParser(description="山本農園 シフト調整ツール")
    ap.add_argument("--config", default=str(HERE / "config.json"))
    sub = ap.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fetch"); f.add_argument("ics"); f.add_argument("--calendar-code")
    p = sub.add_parser("parse"); p.add_argument("ics"); p.add_argument("--month", required=True)
    p.add_argument("-o", "--output"); p.add_argument("--peak", action="store_true", help="繁忙期（9hまで許容）")
    q = sub.add_parser("plan"); q.add_argument("entries")
    q.add_argument("--mode", choices=["split", "all"], default="split",
                   help="split: 決まった曜日は月末確定、追加は「希」のまま（既定）／all: すべて月末に確定")
    q.add_argument("--peak", action="store_true"); q.add_argument("--target-person-days", type=int)
    k = sub.add_parser("kyugyo", help="休業手当のベース（平均賃金）を計算")
    k.add_argument("wages", help="月別賃金CSV（month,person,total_pay,work_days）")
    k.add_argument("--as-of", required=True, help="休業日 YYYY-MM-DD")
    k.add_argument("--hours", type=float, help="その日に実際に働いた実働時間（一部休業の差額を計算）")
    a = sub.add_parser("all"); a.add_argument("ics"); a.add_argument("--month", required=True)
    a.add_argument("--mode", choices=["split", "all"], default="split")
    a.add_argument("--peak", action="store_true"); a.add_argument("--target-person-days", type=int)
    a.add_argument("-o", "--output")

    args = ap.parse_args()
    if args.cmd == "fetch":
        cmd_fetch(args)
    elif args.cmd == "parse":
        cmd_parse(args)
    elif args.cmd == "plan":
        cmd_plan(args)
    elif args.cmd == "kyugyo":
        cmd_kyugyo(args)
    elif args.cmd == "all":
        args.entries = str(cmd_parse(args))
        print()
        cmd_plan(args)


if __name__ == "__main__":
    main()
