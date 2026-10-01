import sys, os
# make the fetcher modules (paths, make_derivative, install_source, fetch_request, …) importable
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
