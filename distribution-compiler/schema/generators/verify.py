import re, sys

for f in sys.argv[1:]:
    t = open(f).read()
    name = f.split('/')[-1]
    bad = 0
    for b in re.findall(r'<pre\b[^>]*>(.*?)</pre>', t, re.S):
        o = len(re.findall(r'<span\b', b))
        c = len(re.findall(r'</span>', b))
        if o != c:
            bad += 1
    print(f"{name}: unbalanced <pre> blocks = {bad}")

# show a highlight region in the comparison to confirm hl spans survived expansion
comp = [f for f in sys.argv[1:] if 'construction' in f]
if comp:
    t = open(comp[0]).read()
    i = t.find('"p10": 1790')
    if i > 0:
        print("--- hl region (comparison) ---")
        print(t[i-120:i+80])
