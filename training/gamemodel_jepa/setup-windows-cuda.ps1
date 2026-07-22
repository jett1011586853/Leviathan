$ErrorActionPreference = "Stop"

$Python = (py -3.12 -c "import sys; print(sys.executable)").Trim()
if (-not (Test-Path -LiteralPath $Python)) {
  throw "CPython 3.12 is required. Install it before running this setup script."
}

& $Python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install "numpy>=1.26,<3" "pillow>=10,<13" "pytest>=8,<10"
& .\.venv\Scripts\python.exe -m pip install torch==2.12.0 --index-url https://download.pytorch.org/whl/cu130
& .\.venv\Scripts\python.exe -m pip install -e .

& .\.venv\Scripts\python.exe -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
