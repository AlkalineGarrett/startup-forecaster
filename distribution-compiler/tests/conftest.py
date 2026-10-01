import sys, os
# make the compiler modules (compile/distributions/formula/preview) importable
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for p in (os.path.join(ROOT, "compiler"), ROOT):
    if p not in sys.path:
        sys.path.insert(0, p)
