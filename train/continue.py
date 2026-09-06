"""`train/continue.py` is the filename the brief names; `continue` is a Python
keyword, so the module cannot be imported under it. The implementation lives in
`train/continue_run.py`; this file keeps `python train/continue.py ...` working.
"""

from train.continue_run import main

if __name__ == "__main__":
    raise SystemExit(main())
