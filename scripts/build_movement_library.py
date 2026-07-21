#!/usr/bin/env python3
"""
build_movement_library.py
Biến Free Exercise DB (yuhonas/free-exercise-db, Unlicense/public-domain)
thành movement library theo schema §2 của data model.

Nguyên tắc:
  - Field map deterministic  -> tin cậy, dùng luôn.
  - Field suy heuristic       -> gắn needs_review, PHẢI người duyệt.
  - Field an toàn (contraindication) -> chỉ SEED ứng viên + needs_review,
                                        KHÔNG bao giờ để heuristic làm chân lý.
Chạy lại được: input exercises.json -> output movement_library.json
"""
import json, re, sys

SRC = "exercises.json"
IMG_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/"

# ---------- vocab normalize ----------
MUSCLE_MAP = {
    "abdominals":"abs","middle back":"mid_back","lower back":"lower_back",
    "lats":"lats","traps":"traps","quadriceps":"quads","hamstrings":"hamstrings",
    "glutes":"glutes","calves":"calves","chest":"chest","shoulders":"shoulders",
    "triceps":"triceps","biceps":"biceps","forearms":"forearms","neck":"neck",
    "adductors":"adductors","abductors":"abductors",
}
EQUIP_MAP = {
    "body only":"bodyweight","dumbbell":"dumbbell","barbell":"barbell",
    "kettlebells":"kettlebell","bands":"resistance_band","cable":"cable",
    "machine":"machine","medicine ball":"medicine_ball","exercise ball":"stability_ball",
    "foam roll":"foam_roller","e-z curl bar":"ez_bar","other":"other",None:"unknown",
}

# ---------- exercise_type ----------
def exercise_type(cat):
    if cat in ("strength","powerlifting","olympic weightlifting","strongman","plyometrics"):
        return "resistance"
    if cat == "cardio":
        return "cardio"
    if cat == "stretching":
        return "mobility"
    return "resistance"

# ---------- difficulty 1-5 (chừa 1 & 4 cho tinh chỉnh tay) ----------
DIFF = {"beginner":2,"intermediate":3,"expert":5}

# ---------- movement_pattern (HEURISTIC -> needs_review) ----------
def movement_pattern(e):
    n = e["name"].lower()
    force = e.get("force")
    prim = set(e.get("primaryMuscles",[]))
    def has(*w): return any(x in n for x in w)
    if has("squat") and not has("split squat"):           return "squat"
    if has("deadlift","romanian","good morning","hip thrust","swing","kettlebell swing","hyperextension","back extension"):
        return "hinge"
    if has("lunge","split squat","step-up","step up","bulgarian"): return "lunge"
    if has("carry","farmer"):                              return "carry"
    if has("run","sprint","jog","walk","treadmill","cycling","bike","row","elliptical") and e.get("category")=="cardio":
        return "gait"
    if has("twist","rotation","woodchop","wood chop","russian twist"): return "rotation"
    if force=="push":
        if has("overhead","military","shoulder press","push press") or "shoulders" in prim: return "push_v"
        if has("row"):                                    return "pull_h"
        return "push_h"
    if force=="pull":
        if has("pull-up","pull up","pulldown","pull-down","chin-up","chin up","lat pull"): return "pull_v"
        if has("row"):                                    return "pull_h"
        if e.get("mechanic")=="isolation":                return "isolation"
        return "pull_h"
    if e.get("mechanic")=="isolation":                    return "isolation"
    return "isolation"  # fallback an toàn, sẽ được review

# ---------- goal_fit (HEURISTIC -> needs_review) ----------
def goal_fit(e):
    cat, mech = e.get("category"), e.get("mechanic")
    if cat in ("powerlifting","olympic weightlifting","strongman"): return ["strength","power"]
    if cat=="plyometrics":                                          return ["power"]
    if cat=="cardio":                                               return ["endurance"]
    if cat=="stretching":                                           return ["mobility"]
    if cat=="strength":
        return ["strength","hypertrophy"] if mech=="compound" else ["hypertrophy"]
    return ["general"]

# ---------- is_unilateral (HEURISTIC -> needs_review) ----------
UNI = ["single-arm","single arm","one-arm","one arm","single-leg","single leg",
       "one-leg","one leg","split","pistol","bulgarian","lunge","step-up","step up"]
def is_unilateral(name):
    n=name.lower()
    return any(u in n for u in UNI)

# ---------- contraindication CANDIDATES (SEED ONLY -> needs_review, KHÔNG chân lý) ----------
def contra_candidates(e):
    n=e["name"].lower(); prim=set(e.get("primaryMuscles",[])); sec=set(e.get("secondaryMuscles",[]))
    force=e.get("force"); out=[]
    def has(*w): return any(x in n for x in w)
    # lower back load
    if "lower back" in prim or "lower back" in sec or has("deadlift","good morning","bent over","bent-over","romanian","clean","snatch"):
        out.append({"injury_area":"lower_back","reason":"tải cột sống thắt lưng (ứng viên — cần PT duyệt)"})
    # overhead / shoulder
    if force=="push" and ("shoulders" in prim) and has("overhead","press","military","push press","jerk","snatch"):
        out.append({"injury_area":"shoulder","reason":"gập/đẩy qua đầu (ứng viên — cần PT duyệt)"})
    # knee under load
    if has("squat","lunge","split squat","step-up","step up","pistol","jump") or ("quadriceps" in prim and e.get("category") in ("strength","powerlifting","plyometrics")):
        out.append({"injury_area":"knee","reason":"tải khớp gối (ứng viên — cần PT duyệt)"})
    return out

# ---------- default_prescription theo goal (TEMPLATE) ----------
def default_rx(gf, etype):
    if etype=="cardio":   return {"note":"theo duration/pace/interval","needs_review":True}
    if etype=="mobility": return {"sets":1,"hold_sec":30,"needs_review":True}
    if "strength" in gf:  return {"sets":3,"rep_range":[4,6],"rest_sec":150,"needs_review":True}
    if "power" in gf:     return {"sets":4,"rep_range":[2,5],"rest_sec":180,"needs_review":True}
    return {"sets":3,"rep_range":[8,12],"rest_sec":75,"needs_review":True}  # hypertrophy default

def transform(e):
    etype = exercise_type(e.get("category"))
    gf = goal_fit(e)
    contras = contra_candidates(e)
    return {
        "exercise_id": e["id"],
        "name": e["name"],
        "aliases": [],
        "exercise_type": etype,
        # --- deterministic (tin cậy) ---
        "primary_muscles": [MUSCLE_MAP.get(m,m) for m in e.get("primaryMuscles",[])],
        "secondary_muscles":[MUSCLE_MAP.get(m,m) for m in e.get("secondaryMuscles",[])],
        "equipment":[EQUIP_MAP.get(e.get("equipment"), e.get("equipment") or "unknown")],
        "difficulty": DIFF.get(e.get("level"),3),
        "is_compound": e.get("mechanic")=="compound",
        "cues": e.get("instructions",[]),           # từ nguồn kiểm chứng
        "media": {
            "start_img": IMG_BASE+e["images"][0] if e.get("images") else None,
            "end_img":   IMG_BASE+e["images"][1] if len(e.get("images",[]))>1 else None,
            "video_url": None,                       # phủ dần pha sau
        },
        "source": {"repo":"yuhonas/free-exercise-db","license":"Unlicense","src_category":e.get("category"),"src_level":e.get("level")},
        # --- heuristic (PHẢI duyệt) ---
        "movement_pattern": movement_pattern(e),
        "goal_fit": gf,
        "is_unilateral": is_unilateral(e["name"]),
        # --- an toàn: chỉ ứng viên ---
        "contraindications": contras,
        # --- để link tay ---
        "progression_of": None,
        "regression_of": None,
        "default_prescription": default_rx(gf, etype),
        # --- cờ review ---
        "needs_review": {
            "movement_pattern": True,
            "goal_fit": True,
            "is_unilateral": True,
            "contraindications": True,   # LUÔN true — an toàn không auto
            "progression_link": True,
        },
    }

# ---------- curation cho target user (beginner–intermediate, home/minimal) ----------
def keep_for_target(e_src):
    lvl = e_src.get("level")
    cat = e_src.get("category")
    equip = e_src.get("equipment")
    if lvl=="expert": return False
    if cat in ("olympic weightlifting","strongman","powerlifting"): return False   # nâng cao, ngoài target
    # ưu tiên thiết bị gia đình / tối thiểu
    if equip in ("machine","cable","e-z curl bar"): return False
    return True

def main():
    data = json.load(open(SRC))
    full = [transform(e) for e in data]
    json.dump(full, open("movement_library_full.json","w"), ensure_ascii=False, indent=2)

    curated_src = [e for e in data if keep_for_target(e)]
    curated = [transform(e) for e in curated_src]
    json.dump(curated, open("movement_library_curated.json","w"), ensure_ascii=False, indent=2)

    # report
    from collections import Counter
    def rc(items, key):
        c=Counter()
        for it in items:
            v=it[key]
            if isinstance(v,list):
                for x in v: c[x]+=1
            else: c[v]+=1
        return c.most_common()
    print(f"FULL     : {len(full)} bài -> movement_library_full.json")
    print(f"CURATED  : {len(curated)} bài (target: beginner-intermediate, home/minimal) -> movement_library_curated.json")
    print()
    print("Curated — exercise_type:", rc(curated,"exercise_type"))
    print("Curated — movement_pattern:", rc(curated,"movement_pattern"))
    print("Curated — goal_fit:", rc(curated,"goal_fit"))
    print("Curated — equipment:", rc(curated,"equipment"))
    n_contra=sum(1 for e in curated if e["contraindications"])
    print(f"Curated — có contraindication candidate: {n_contra}/{len(curated)} (tất cả cần PT duyệt)")

if __name__=="__main__":
    main()
