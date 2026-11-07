#!/usr/bin/env python
"""就是棒 (myscore.games) 對手數據同步：抓 leagues.json 列出的分組，輸出 JSON 給網站匯入。

用法：python sync.py [--out 目錄]
輸出：scout-YYYY-MM-DD.json、latest.json、sync.log（預設在 repo 外的 ../../../scout-data）
退出碼：0 成功；1 失敗（此時不覆寫 latest.json）

只用 Python 標準函式庫，不用 AI、不用安裝套件。
隱私：不讀生日欄；只取畫面上已遮蔽的姓名，不讀表單隱藏欄位裡的完整姓名。
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime
from html.parser import HTMLParser

ORIGIN = "https://myscore.games"
USER_AGENT = "Mozilla/5.0 (compatible; baseball-stats-sync/1.0)"
REQUEST_GAP = 1.5     # 兩次請求間隔（秒），避免造成對方負擔
RETRIES = 1
SCHEMA = 1
MIN_PLAYER_RATIO = 0.6   # 分組打者筆數低於上次的此比例，視為解析異常

STANDINGS_HEAD = ["戰績", "球隊", "勝場", "敗場", "和局", "勝率", "勝差"]
SCHEDULE_HEAD = ["日期", "時間", "賽事", "場地", "結果"]
# (網站表頭, 輸出欄位)；欄位命名與專案 BattingLine/PitchingLine 一致（d2/d3）
BATTING_COLS = [("Player", None), ("Ｇ", "G"), ("PA", "PA"), ("AB", "AB"), ("H", "H"), ("2B", "d2"),
                ("3B", "d3"), ("HR", "HR"), ("BB", "BB"), ("SO", "SO"), ("RBI", "RBI"), ("R", "R"),
                ("OBP", "OBP"), ("SLG", "SLG"), ("AVG", "AVG")]
PITCHING_COLS = [("Player", None), ("W", "W"), ("L", "L"), ("SV", "SV"), ("G", "G"), ("IP", "IP"),
                 ("AB", "AB"), ("H", "H"), ("2B", "d2"), ("3B", "d3"), ("HR", "HR"), ("BB", "BB"),
                 ("SO", "SO"), ("R", "R"), ("ER", "ER"), ("AVG", "AVG"), ("ERA", "ERA")]


class SyncError(Exception):
    """無法信任本次結果，必須中止且不覆寫 latest.json"""


class TableParser(HTMLParser):
    """把頁面所有 <table> 轉成 [[{text, hrefs}]]。巢狀表格各自獨立，註解內容自動略過。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self.title = ""
        self._stack = []
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        elif tag == "table":
            self._stack.append({"rows": [], "row": None, "cell": None})
        elif not self._stack:
            return
        elif tag == "tr":
            self._close_row()
            self._stack[-1]["row"] = []
        elif tag in ("td", "th"):
            self._close_cell()
            if self._stack[-1]["row"] is None:
                self._stack[-1]["row"] = []
            self._stack[-1]["cell"] = {"text": [], "hrefs": []}
        elif tag == "a" and self._stack[-1]["cell"] is not None:
            href = dict(attrs).get("href")
            if href:
                self._stack[-1]["cell"]["hrefs"].append(href)
        elif tag == "br" and self._stack[-1]["cell"] is not None:
            self._stack[-1]["cell"]["text"].append(" ")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "table" and self._stack:
            self._close_row()
            self.tables.append(self._stack.pop()["rows"])
        elif not self._stack:
            return
        elif tag == "tr":
            self._close_row()
        elif tag in ("td", "th"):
            self._close_cell()

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif self._stack and self._stack[-1]["cell"] is not None:
            self._stack[-1]["cell"]["text"].append(data)

    def _close_cell(self):
        top = self._stack[-1]
        if top["cell"] is not None:
            cell = top["cell"]
            top["row"].append({"text": " ".join("".join(cell["text"]).split()), "hrefs": cell["hrefs"]})
            top["cell"] = None

    def _close_row(self):
        top = self._stack[-1]
        self._close_cell()
        if top["row"]:
            top["rows"].append(top["row"])
        top["row"] = None


def parse_tables(html):
    p = TableParser()
    p.feed(html)
    p.close()
    return p


def texts(row):
    return [c["text"] for c in row]


def find_rows(tables, head):
    """回傳第一個含指定表頭列的表格中、表頭之後的資料列；找不到回傳 None"""
    for rows in tables:
        for i, row in enumerate(rows):
            if texts(row) == head:
                return rows[i + 1:]
    return None


def number(s):
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    if re.fullmatch(r"-?\d*\.\d+", s):
        return float(s)
    return s


def parse_player(cell):
    m = re.fullmatch(r"(\S+)\s+(.+)", cell)
    return (m.group(1), m.group(2)) if m else ("", cell)


def parse_stat_rows(rows, cols):
    out = []
    for row in rows:
        vals = texts(row)
        if len(vals) != len(cols):
            continue
        num, name = parse_player(vals[0])
        item = {"num": num, "name": name}
        for (_, key), v in zip(cols[1:], vals[1:]):
            item[key] = v if key == "IP" else number(v)
        out.append(item)
    return out


def parse_group_page(html):
    page = parse_tables(html)
    rows = find_rows(page.tables, STANDINGS_HEAD)
    if rows is None:
        raise SyncError("找不到戰績表（表頭與預期不符，網站可能改版）")
    teams = []
    for row in rows:
        link = next((h for c in row for h in c["hrefs"] if "team_id=" in h), None)
        vals = texts(row)
        if not link or len(vals) < 7:
            continue
        teams.append({"teamId": int(re.search(r"team_id=(\d+)", link).group(1)), "rank": number(vals[0]),
                      "name": vals[1], "w": number(vals[2]), "l": number(vals[3]), "t": number(vals[4])})
    stamp = re.findall(r"最後更新時間：\s*(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)", html)
    return page.title.strip(), teams, (stamp[0] if stamp else "")


def parse_games(rows, team_name):
    games = []
    for row in rows or []:
        vals = texts(row)
        if len(vals) < 5:
            continue
        # 已賽「A vs. B 2 : 5」；未賽「A vs. B :」或無比分
        m = re.fullmatch(r"(.+?) vs\. (.+?)(?: (\d+) : (\d+)| :)?", vals[2])
        if not m:
            continue
        home, away = m.group(1), m.group(2)
        if team_name not in (home, away):
            raise SyncError(f"賽程列找不到本隊 {team_name}：{vals[2]}")
        mine_first = team_name == home
        result, us, them = "", None, None
        if m.group(3) is not None:
            a, b = int(m.group(3)), int(m.group(4))
            us, them = (a, b) if mine_first else (b, a)
            result = "W" if us > them else "L" if us < them else "T"
        link = next((h for c in row for h in c["hrefs"] if "id=" in h), "")
        rec = re.search(r"[?&]id=(\d+)", link)
        games.append({"date": vals[0], "time": vals[1], "opp": away if mine_first else home,
                      "venue": vals[3], "us": us, "them": them, "result": result,
                      "recId": int(rec.group(1)) if rec else None})
    return games


def parse_team_page(html, team):
    page = parse_tables(html)
    games = parse_games(find_rows(page.tables, SCHEDULE_HEAD), team["name"])
    played = any(g["result"] for g in games)
    bat = find_rows(page.tables, [h for h, _ in BATTING_COLS])
    pit = find_rows(page.tables, [h for h, _ in PITCHING_COLS])
    if played and (bat is None or pit is None):
        raise SyncError(f"{team['name']} 已有比賽但找不到打者/投手表（表頭與預期不符，網站可能改版）")
    batting = parse_stat_rows(bat or [], BATTING_COLS)
    pitching = parse_stat_rows(pit or [], PITCHING_COLS)
    if played and not (batting and pitching):
        raise SyncError(f"{team['name']} 已有比賽但解析不到球員數據")
    return dict(team, games=games, batting=batting, pitching=pitching)


class Fetcher:
    def __init__(self):
        self.last = 0.0
        self.count = 0

    def get(self, url):
        err = None
        for _ in range(RETRIES + 1):
            wait = REQUEST_GAP - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            self.count += 1
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=30) as r:
                    return r.read().decode("utf-8", "replace")
            except Exception as e:  # 網路錯誤一律重試，最後由呼叫端決定如何處理
                err = e
        raise IOError(f"{url}: {err}")


def previous_group(prev, game_id):
    for g in (prev or {}).get("groups", []):
        if g.get("gameId") == game_id:
            return g
    return None


def sync_group(cfg, fetcher, prev_group, warnings):
    gid, group = cfg["gameId"], cfg["group"]
    url = f"{ORIGIN}/index.php?game_id={gid}"
    try:
        title, teams, site_updated = parse_group_page(fetcher.get(url))
    except IOError as e:
        raise SyncError(f"{group} 首頁抓取失敗：{e}")
    if not teams:
        raise SyncError(f"{group} 抓到 0 隊")
    if group not in title:
        raise SyncError(f"game_id {gid} 的頁面標題是「{title}」，與設定的「{group}」不符")
    tournament = title.split("【")[0].strip()

    prev_teams = {t["teamId"]: t for t in (prev_group or {}).get("teams", [])}
    done = []
    for team in teams:
        url = f"{ORIGIN}/team_detail.php?game_id={gid}&team_id={team['teamId']}"
        try:
            done.append(parse_team_page(fetcher.get(url), team))
        except IOError as e:
            old = prev_teams.get(team["teamId"])
            if not old:
                raise SyncError(f"{group}/{team['name']} 抓取失敗且無舊資料：{e}")
            warnings.append(f"{group}/{team['name']} 抓取失敗，沿用上次資料")
            done.append(dict(old, stale=True))

    if prev_group:
        before = sum(len(t["batting"]) for t in prev_group["teams"])
        after = sum(len(t["batting"]) for t in done)
        if before and after < before * MIN_PLAYER_RATIO:
            raise SyncError(f"{group} 打者筆數由 {before} 掉到 {after}，疑似解析異常")
    return {"gameId": gid, "level": cfg["level"], "group": group, "tournament": tournament,
            "siteUpdated": site_updated, "teams": done}


def played_count(team):
    return sum(1 for g in team.get("games", []) if g.get("result"))


def changed_teams(group, prev_group):
    prev = {t["teamId"]: t for t in (prev_group or {}).get("teams", [])}
    return [t["name"] for t in group["teams"]
            if t["teamId"] in prev and played_count(t) > played_count(prev[t["teamId"]])]


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="同步就是棒對手數據")
    ap.add_argument("--out", default=os.path.normpath(os.path.join(here, "..", "..", "..", "scout-data")))
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(args.out, exist_ok=True)
    latest = os.path.join(args.out, "latest.json")
    now = datetime.now()
    lines = []

    def say(msg):
        print(msg)
        lines.append(msg)

    def finish(code):
        with open(os.path.join(args.out, "sync.log"), "a", encoding="utf-8") as f:
            f.write(f"=== {now:%Y-%m-%d %H:%M:%S} exit={code}\n" + "\n".join(lines) + "\n")
        return code

    try:
        with open(os.path.join(here, "leagues.json"), encoding="utf-8") as f:
            leagues = json.load(f)
        prev = None
        if os.path.exists(latest):
            with open(latest, encoding="utf-8") as f:
                prev = json.load(f)
        fetcher, warnings, groups = Fetcher(), [], []
        for cfg in leagues:
            pg = previous_group(prev, cfg["gameId"])
            g = sync_group(cfg, fetcher, pg, warnings)
            groups.append(g)
            changed = changed_teams(g, pg)
            say(f"✓ {g['group']}：{len(g['teams'])} 隊，網站更新 {g['siteUpdated'] or '未知'}"
                + (f"，有新比賽：{'、'.join(changed)}" if changed else ""))
        data = {"schema": SCHEMA, "source": "myscore.games", "syncedAt": now.strftime("%Y-%m-%dT%H:%M:%S"),
                "groups": groups}
        dated = os.path.join(args.out, f"scout-{now:%Y-%m-%d}.json")
        write_json(dated, data)
        write_json(latest, data)
        for w in warnings:
            say(f"⚠ {w}")
        say(f"完成：{len(groups)} 組、{sum(len(g['teams']) for g in groups)} 隊，"
            f"{fetcher.count} 次請求 → {dated}")
        return finish(0)
    except SyncError as e:
        say(f"✗ 同步中止，latest.json 未更新：{e}")
        return finish(1)
    except Exception as e:  # 任何未預期錯誤都要留下紀錄，並同樣不更新 latest.json
        say(f"✗ 未預期錯誤，latest.json 未更新：{type(e).__name__}: {e}")
        return finish(1)


if __name__ == "__main__":
    sys.exit(main())
