#!/usr/bin/env python3
"""WCAG 对比度校验：逐主题计算 --text-muted on --bg-app。

用法：python scripts/verify_contrast.py
输出每个主题的当前值对比度 + 提议值对比度，标注是否通过 AA 正文标准(4.5:1)。
"""
from typing import Dict, Tuple

def _lin(c: float) -> float:
    c = c / 255.0
    if c <= 0.03928:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4

def rel_lum(rgb: Tuple[int, int, int]) -> float:
    r, g, b = (_lin(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(a: Tuple[int, int, int], b: Tuple[int, int, int]) -> float:
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

# (bg-app, current --text-muted, proposed --text-muted, theme label)
THEMES: Dict[str, Tuple[Tuple[int,int,int], Tuple[int,int,int], Tuple[int,int,int]]] = {
    "ink":   ((20,20,20),    (150,150,150), (150,150,150)),
    "paper": ((255,255,255), (106,106,106), (106,106,106)),
    "wood":  ((213,202,186), (114,96,72),   (114,96,72)),
}

AA = 4.5
AA_LARGE = 3.0

def hexstr(rgb):
    return "#" + "".join(f"{x:02X}" for x in rgb)

def verdict(c: float) -> str:
    if c >= AA:
        return "PASS (AA normal)"
    if c >= AA_LARGE:
        return "WARN (only AA large >=18px)"
    return "FAIL"

print(f"{'theme':<10} {'bg':<9} {'muted':<9} {'current':>9} {'proposed':>10}  status")
print("-" * 78)
all_ok = True
for name, (bg, cur, prop) in THEMES.items():
    cc = contrast(cur, bg)
    pc = contrast(prop, bg)
    changed = cur != prop
    status = verdict(pc)
    if pc < AA:
        all_ok = False
    print(f"{name:<10} {hexstr(bg):<9} {hexstr(prop):<9} {cc:>8.2f}:1 {pc:>9.2f}:1  "
          f"{'(changed) ' if changed else ''}{status}")
print("-" * 78)
print("ALL PROPOSED PASS AA (4.5:1):" , all_ok)
