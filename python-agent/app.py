"""uvicorn 启动入口。

把 ``src/`` 加入模块搜索路径后再暴露 FastAPI 应用，这样**不需要安装包**也能直接运行：

```bash
cd python-agent
uvicorn app:app --reload --port 8000
```

（若已执行 ``pip install -e .``，也可以直接用 ``uvicorn agent_project.api.main:app``。）
"""

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from agent_project.api.main import app  # noqa: E402

__all__ = ["app"]
