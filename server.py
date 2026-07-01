from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
mimetypes.add_type("application/javascript", ".mjs")
import os
import re
import sys
import threading
import time
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

try:
    import fitz  # PyMuPDF
except Exception:  # pragma: no cover
    fitz = None

try:
    from openai import OpenAI
except Exception:
    OpenAI = None

try:
    from anthropic import Anthropic
except Exception:
    Anthropic = None


APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent
WEB_DIR = APP_DIR / "web"
DATA_DIR = APP_DIR / "data"
EXTRACTED_DIR = DATA_DIR / "extracted"
TRANSLATIONS_DIR = DATA_DIR / "translations"
ANNOTATIONS_DIR = DATA_DIR / "annotations"
COMMENTS_DIR = DATA_DIR / "comments"
RENDERED_DIR = DATA_DIR / "rendered"
TRANSLATED_DOCS_DIR = APP_DIR / "translated"
MANIFEST_PATH = DATA_DIR / "papers.json"
READ_STATUS_PATH = DATA_DIR / "read_status.json"
LIBRARY_STATE_PATH = DATA_DIR / "library_state.json"
AUTH_PASSWORD = os.environ.get("READER_PASSWORD", "")
SUPPORTED_EXTS = {".pdf", ".md", ".txt", ".html", ".htm"}
DISPLAY_EXTS = {".pdf", ".md", ".txt", ".html", ".htm"}
ORIGINAL_EXTS = {".pdf"}
PDF_RENDER_SCALE = 4.0
TRANSLATION_MARKERS = (
    "_zh",
    "_cn",
    "_chinese",
    "_translation",
    "_translated",
    "_中文",
    "_译文",
    "_翻译",
    "-zh",
    "-cn",
    "-chinese",
    "-translation",
    "-translated",
    "-中文",
    "-译文",
    "-翻译",
)
TRANSLATION_KEYWORDS = (
    "中文",
    "译文",
    "翻译",
    "中文版",
    "中译",
    "zh",
    "cn",
    "chinese",
    "translation",
    "translated",
)
TRANSLATION_PRIORITY = {".pdf": 0, ".html": 1, ".htm": 2, ".md": 3, ".txt": 4}
SOURCE_MAP_NAME = "source_map.json"
MATCH_STOP_WORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "role",
    "new",
    "using",
}
READER_FOLDER_MARKERS = (
    "_reader",
    "-reader",
    " reader",
    "_阅读",
    "-阅读",
    "_译文",
    "-译文",
    "_翻译",
    "-翻译",
    "_中文",
    "-中文",
)
READER_TRANSLATION_STEMS = {"paper", "translation", "translated", "译文", "翻译", "中文"}
RELOAD_WATCH_FILES = (Path(__file__).resolve(),)
RELOAD_MTIMES = {path: path.stat().st_mtime for path in RELOAD_WATCH_FILES if path.exists()}

TRANSLATE_API_KEY = os.environ.get("TRANSLATE_API_KEY", "")
TRANSLATE_BASE_URL = os.environ.get("TRANSLATE_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")
TRANSLATE_MODEL = os.environ.get("TRANSLATE_MODEL", "gemini-3.1-flash-lite")
TRANSLATE_CHUNK_SIZE = 4  # pages per chunk


def start_reload_watcher(interval: float = 1.5) -> None:
    def watch() -> None:
        while True:
            time.sleep(interval)
            for path, previous_mtime in RELOAD_MTIMES.items():
                try:
                    current_mtime = path.stat().st_mtime
                except OSError:
                    continue
                if current_mtime != previous_mtime:
                    print("Server code changed; restarting literature reader...", flush=True)
                    os.execv(sys.executable, [sys.executable, *sys.argv])

    threading.Thread(target=watch, daemon=True).start()


def ensure_dirs() -> None:
    for path in (DATA_DIR, EXTRACTED_DIR, TRANSLATIONS_DIR, ANNOTATIONS_DIR, COMMENTS_DIR, RENDERED_DIR, TRANSLATED_DOCS_DIR):
        path.mkdir(parents=True, exist_ok=True)


def cleanup_old_png_cache() -> None:
    """Remove old PNG cache files (now using JPEG)."""
    try:
        for f in RENDERED_DIR.glob("*.png"):
            f.unlink(missing_ok=True)
    except Exception:
        pass


def cleanup_expired_sessions() -> None:
    """Remove expired sessions from disk."""
    now = datetime.now().timestamp()
    expired = [t for t, s in _current_sessions.items() if s.get("expiresAt", 0) < now]
    for t in expired:
        del _current_sessions[t]
    if expired:
        _save_sessions()


def safe_id(rel_path: str) -> str:
    return hashlib.sha1(rel_path.replace("\\", "/").encode("utf-8")).hexdigest()[:16]


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_library_state(scope=None):
    user_id = getattr(_request_context, "user_id", None)
    if scope == "public" or not user_id:
        state = read_json(LIBRARY_STATE_PATH, {})
        state.setdefault("folders", [])
        state.setdefault("hidden", [])
        state.setdefault("names", {})
        state.setdefault("translations", {})
        return state
    return get_user_library_state(user_id)


def write_library_state(state):
    user_id = getattr(_request_context, "user_id", None)
    if user_id:
        write_user_library_state(user_id, state)
        return
    state["folders"] = sorted(set(state.get("folders", [])), key=lambda name: name.lower())
    state["hidden"] = sorted(set(state.get("hidden", [])))
    write_json(LIBRARY_STATE_PATH, state)


def read_read_status():
    user_id = getattr(_request_context, "user_id", None)
    if user_id:
        return get_user_read_status(user_id)
    return read_json(READ_STATUS_PATH, {})


def write_read_status(status):
    user_id = getattr(_request_context, "user_id", None)
    if user_id:
        write_user_read_status(user_id, status)
        return
    write_json(READ_STATUS_PATH, status)


def read_annotations(paper_id: str):
    user_id = getattr(_request_context, "user_id", None)
    if user_id:
        return get_user_annotations(user_id, paper_id)
    return read_json(ANNOTATIONS_DIR / f"{paper_id}.json", {"items": []})


def write_annotations(paper_id: str, data: dict):
    user_id = getattr(_request_context, "user_id", None)
    if user_id:
        write_user_annotations(user_id, paper_id, data)
        return
    write_json(ANNOTATIONS_DIR / f"{paper_id}.json", data)


COMMENTS_FILE = COMMENTS_DIR / "global.json"


def read_comments() -> dict:
    data = read_json(COMMENTS_FILE, {"comments": []})
    changed = False
    for i, c in enumerate(data.get("comments", [])):
        if not c.get("id"):
            c["id"] = "c" + str(int(datetime.now().timestamp() * 1000)) + str(i)
            changed = True
        if "userId" not in c:
            c["userId"] = ""
            changed = True
        if "email" not in c:
            c["email"] = ""
            changed = True
    if changed:
        write_json(COMMENTS_FILE, data)
    return data


def write_comment(text: str, user_id: str, email: str, reply_to: str | None = None) -> dict:
    data = read_comments()
    comment = {
        "id": "c" + str(int(datetime.now().timestamp() * 1000)),
        "text": text,
        "userId": user_id or "",
        "email": email or "",
        "createdAt": datetime.now().isoformat(timespec="seconds"),
        "replyTo": reply_to or None,
    }
    data.setdefault("comments", []).append(comment)
    write_json(COMMENTS_FILE, data)
    return data


def delete_comment(comment_id: str, user_id: str, admin: bool) -> dict:
    data = read_comments()
    comments = data.get("comments", [])
    target = next((c for c in comments if c.get("id") == comment_id), None)
    if not target:
        raise ValueError("评论不存在")
    owner = target.get("userId", "")
    if not admin and owner and owner != user_id:
        raise ValueError("只能删除自己的评论")
    data["comments"] = [c for c in comments if c.get("id") != comment_id]
    write_json(COMMENTS_FILE, data)
    return data


# ── 用户认证系统 ──

USERS_DIR = DATA_DIR / "users"
USERS_FILE = USERS_DIR / "users.json"
SESSION_SECRET = os.environ.get("SESSION_SECRET", "literature-reader-secret-key-2024")
ADMIN_EMAILS = {"ouyangai2026@163.com"}

# 当前活跃用户的 session（持久化到磁盘）
SESSIONS_FILE = DATA_DIR / "sessions.json"
_current_sessions = read_json(SESSIONS_FILE, {})  # token -> {userId, email, expiresAt}

# 线程本地存储，用于在请求处理中传递用户上下文
_request_context = threading.local()


def hash_password(password: str) -> str:
    """使用 SHA-256 哈希密码"""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password(password: str, hashed: str) -> bool:
    """验证密码"""
    return hash_password(password) == hashed


def get_users() -> dict:
    """获取所有用户"""
    return read_json(USERS_FILE, {})


def save_users(users: dict) -> None:
    """保存用户数据"""
    USERS_DIR.mkdir(parents=True, exist_ok=True)
    write_json(USERS_FILE, users)


def get_user_by_email(email: str) -> dict | None:
    """根据邮箱查找用户"""
    users = get_users()
    for user_id, user in users.items():
        if user.get("email") == email:
            return {"id": user_id, **user}
    return None


def create_user(email: str, password: str) -> dict:
    """创建新用户"""
    users = get_users()
    user_id = email
    if user_id in users:
        raise ValueError("用户已存在")
    users[user_id] = {
        "email": email,
        "password": hash_password(password),
        "createdAt": datetime.now().isoformat(timespec="seconds"),
        "isAdmin": email in ADMIN_EMAILS,
    }
    save_users(users)
    # 创建用户数据目录
    user_dir = USERS_DIR / user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    (user_dir / "annotations").mkdir(exist_ok=True)
    (user_dir / "papers").mkdir(exist_ok=True)
    (user_dir / "translations").mkdir(exist_ok=True)
    return {"id": user_id, "email": email}


def _save_sessions():
    write_json(SESSIONS_FILE, _current_sessions)


def generate_token(user_id: str, email: str) -> str:
    """生成 session token"""
    import secrets
    token = secrets.token_hex(32)
    _current_sessions[token] = {
        "userId": user_id,
        "email": email,
        "expiresAt": (datetime.now().timestamp() + 86400 * 7),  # 7天过期
    }
    _save_sessions()
    return token


def verify_token(token: str) -> dict | None:
    """验证 token 并返回用户信息"""
    if not token or token not in _current_sessions:
        return None
    session = _current_sessions[token]
    if session["expiresAt"] < datetime.now().timestamp():
        del _current_sessions[token]
        _save_sessions()
        return None
    user_id = session["userId"]
    users = get_users()
    admin = users.get(user_id, {}).get("isAdmin", False)
    return {"id": user_id, "email": session["email"], "isAdmin": admin}


def get_current_user(handler) -> dict | None:
    """从请求中获取当前用户"""
    # 从 cookie 中获取 token
    cookies = handler.headers.get("Cookie", "")
    for cookie in cookies.split(";"):
        cookie = cookie.strip()
        if cookie.startswith("session_token="):
            token = cookie.split("=", 1)[1]
            return verify_token(token)
    return None


def get_user_data_dir(user_id: str) -> Path:
    """获取用户数据目录"""
    return USERS_DIR / user_id


def is_admin(user_id=None) -> bool:
    """检查用户是否为管理员"""
    if not user_id:
        return False
    users = get_users()
    return users.get(user_id, {}).get("isAdmin", False)


def ensure_admin():
    """确保管理员邮箱对应的用户被标记为 admin"""
    users = get_users()
    changed = False
    for uid, u in users.items():
        if u.get("email") in ADMIN_EMAILS and not u.get("isAdmin"):
            u["isAdmin"] = True
            changed = True
    if changed:
        save_users(users)


def migrate_user_dirs():
    """将 MD5 hash 目录名迁移为邮箱目录名"""
    if not USERS_DIR.is_dir():
        return
    users = get_users()
    hash_to_email = {}
    for uid in list(users.keys()):
        if "@" in uid:
            continue
        email = users[uid].get("email", "")
        if email:
            hash_to_email[uid] = email
    if not hash_to_email:
        return
    for old_hash, email in hash_to_email.items():
        old_dir = USERS_DIR / old_hash
        new_dir = USERS_DIR / email
        if old_dir.is_dir() and not new_dir.exists():
            old_dir.rename(new_dir)
        users[email] = users.pop(old_hash)
    save_users(users)
    for sess in _current_sessions.values():
        old_uid = sess.get("userId", "")
        if old_uid in hash_to_email:
            sess["userId"] = hash_to_email[old_uid]
    _save_sessions()


def get_scan_root(user_id=None):
    """获取文献扫描根目录：登录用户用自己的 papers 目录，匿名用全局 ROOT_DIR"""
    if user_id:
        users = get_users()
        custom = users.get(user_id, {}).get("storagePath", "")
        if custom:
            p = Path(custom).resolve()
            if p.is_dir():
                return p
        user_papers = get_user_data_dir(user_id) / "papers"
        user_papers.mkdir(parents=True, exist_ok=True)
        return user_papers
    return ROOT_DIR


def get_user_library_state(user_id: str) -> dict:
    """获取用户的 library_state"""
    user_dir = get_user_data_dir(user_id)
    state_path = user_dir / "library_state.json"
    state = read_json(state_path, {})
    state.setdefault("folders", [])
    state.setdefault("hidden", [])
    state.setdefault("names", {})
    state.setdefault("translations", {})
    return state


def write_user_library_state(user_id: str, state: dict) -> None:
    """写入用户的 library_state"""
    user_dir = get_user_data_dir(user_id)
    state_path = user_dir / "library_state.json"
    state["folders"] = sorted(set(state.get("folders", [])), key=lambda name: name.lower())
    state["hidden"] = sorted(set(state.get("hidden", [])))
    write_json(state_path, state)


def get_user_read_status(user_id: str) -> dict:
    """获取用户的已读状态"""
    user_dir = get_user_data_dir(user_id)
    return read_json(user_dir / "read_status.json", {})


def write_user_read_status(user_id: str, status: dict) -> None:
    """写入用户的已读状态"""
    user_dir = get_user_data_dir(user_id)
    write_json(user_dir / "read_status.json", status)


def get_user_annotations(user_id: str, paper_id: str) -> dict:
    """获取用户的批注"""
    user_dir = get_user_data_dir(user_id)
    annotations_dir = user_dir / "annotations"
    annotations_dir.mkdir(exist_ok=True)
    return read_json(annotations_dir / f"{paper_id}.json", {"items": []})


def write_user_annotations(user_id: str, paper_id: str, data: dict) -> None:
    """写入用户的批注"""
    user_dir = get_user_data_dir(user_id)
    annotations_dir = user_dir / "annotations"
    annotations_dir.mkdir(exist_ok=True)
    write_json(annotations_dir / f"{paper_id}.json", data)


_SKIP_DIRS = {
    ".git", ".svn", ".hg", "__pycache__", "node_modules", ".cache",
    ".venv", "venv", "env", ".idea", ".vscode", ".tox", ".mypy_cache",
    "dist", "build", ".next", ".nuxt",
    "files", "smart-paper", "literature_reader", "literature_reader_static",
}


def iter_document_files(include_reader_translations: bool = True, root=None):
    import os
    if root is None:
        root = ROOT_DIR
    for dirpath, dirnames, filenames in os.walk(str(root)):
        # Skip hidden and irrelevant directories
        base = os.path.basename(dirpath)
        if base.startswith(".") and base not in (".", ".."):
            dirnames.clear()
            continue
        if base in _SKIP_DIRS:
            dirnames.clear()
            continue
        # Skip the app directory itself (only when scanning ROOT_DIR)
        if root == ROOT_DIR and os.path.normpath(dirpath) == os.path.normpath(str(APP_DIR)):
            dirnames.clear()
            continue
        # Prune hidden/irrelevant subdirs from traversal
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in _SKIP_DIRS]
        for fname in filenames:
            path = Path(dirpath) / fname
            if path.suffix.lower() not in SUPPORTED_EXTS:
                continue
            yield path
    if include_reader_translations:
        # For per-user scanning, look in user's translations dir
        if root != ROOT_DIR:
            user_translations = root.parent / "translations"
            if user_translations.is_dir():
                for path in user_translations.rglob("*"):
                    if path.is_file() and path.suffix.lower() in SUPPORTED_EXTS:
                        yield path
        for path in TRANSLATED_DOCS_DIR.rglob("*"):
            if path.is_file() and path.suffix.lower() in SUPPORTED_EXTS:
                yield path


def iter_literature_files():
    for path in iter_document_files(include_reader_translations=False):
        if path.suffix.lower() in ORIGINAL_EXTS and not looks_like_translation(path):
            yield path


def looks_like_translation(path: Path) -> bool:
    return classify_document(path)[1]


def classify_document(path: Path):
    reader_bundle = classify_reader_bundle_file(path)
    if reader_bundle:
        return reader_bundle
    stem = path.stem.strip()
    lower = stem.lower()
    for keyword in ("中文", "译文", "翻译", "中文版", "中译"):
        if keyword in stem:
            base = stem.split(keyword, 1)[0]
            return clean_base_stem(base), True
    english_pattern = r"(?i)(?:[\s._\-\(\[]+)(zh|cn|chinese|translation|translated)(?:[\s._\-\)\]]*)$"
    if re.search(english_pattern, lower):
        base = re.sub(english_pattern, "", stem).strip()
        return clean_base_stem(base), True
    if any(marker in lower for marker in TRANSLATION_MARKERS):
        for marker in TRANSLATION_MARKERS:
            if marker in lower:
                index = lower.index(marker)
                return clean_base_stem(stem[:index]), True
    return clean_base_stem(stem), False


def clean_base_stem(stem: str):
    return re.sub(r"[\s._\-()\[\]【】（）]+$", "", stem).strip()


def strip_reader_folder_name(name: str):
    lower = name.lower()
    for marker in READER_FOLDER_MARKERS:
        if lower.endswith(marker):
            return clean_base_stem(name[: -len(marker)])
    return None


def reader_bundle_base_from_source_map(folder: Path):
    source_map = folder / SOURCE_MAP_NAME
    if not source_map.exists():
        return None
    payload = read_json(source_map, {})
    source_pdf = payload.get("metadata", {}).get("source_pdf")
    if not source_pdf:
        return None
    return clean_base_stem(Path(source_pdf).stem)


def classify_reader_bundle_file(path: Path):
    if APP_DIR in path.parents:
        return None
    if path.suffix.lower() not in DISPLAY_EXTS:
        return None
    user_id = getattr(_request_context, "user_id", None)
    scan_root = get_scan_root(user_id)
    for parent in path.parents:
        if parent == scan_root or parent == ROOT_DIR:
            break
        base = strip_reader_folder_name(parent.name)
        if not base:
            continue
        source_base = reader_bundle_base_from_source_map(parent)
        if source_base:
            return source_base, True
        return base, True
    return None


def group_key(stem: str):
    normalized = re.sub(r"[\s._\-()\[\]【】（）]+", "", stem).lower()
    return normalized or stem.lower()


def match_tokens(text: str):
    words = re.findall(r"[a-zA-Z0-9]+", text.lower())
    return {word for word in words if len(word) > 2 and word not in MATCH_STOP_WORDS}


def first_markdown_heading(path: Path):
    if path.suffix.lower() not in {".md", ".txt"}:
        return ""
    try:
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines()[:40]:
            heading = re.match(r"^\s*#{1,3}\s+(.+?)\s*$", line)
            if heading:
                return heading.group(1)
    except OSError:
        return ""
    return ""


def fuzzy_translation_score(source_path: Path, translation_path: Path):
    source_base = classify_document(source_path)[0]
    translation_base = classify_document(translation_path)[0]
    source_tokens = match_tokens(f"{source_base} {source_path.stem}")
    translation_tokens = match_tokens(f"{translation_base} {translation_path.stem} {first_markdown_heading(translation_path)}")
    if not source_tokens or not translation_tokens:
        return 0
    overlap = len(source_tokens & translation_tokens)
    return overlap / min(len(source_tokens), len(translation_tokens))


def translation_sort_key(path: Path):
    stem = path.stem.lower()
    preferred_bundle_name = 0 if stem in READER_TRANSLATION_STEMS else 1
    return (preferred_bundle_name, TRANSLATION_PRIORITY.get(path.suffix.lower(), 99), path.name.lower())


def file_payload(path: Path):
    stat = path.stat()
    user_id = getattr(_request_context, "user_id", None)
    scan_root = get_scan_root(user_id)
    try:
        rel_path = path.relative_to(scan_root).as_posix()
    except ValueError:
        # Fallback: try ROOT_DIR (for translation files in shared dirs)
        rel_path = path.relative_to(ROOT_DIR).as_posix()
    return {
        "fileName": path.name,
        "relPath": rel_path,
        "ext": path.suffix.lower(),
        "size": stat.st_size,
        "modifiedAt": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
        "url": f"/files/{rel_path}",
    }


def list_library_folders(scope=None):
    virtual = set(read_library_state(scope=scope).get("folders", []))
    physical = set()
    papers = scan_papers(scope=scope)
    for p in papers:
        f = p.get("folder", "")
        if f:
            physical.add(f)
    return sorted(virtual | physical, key=lambda n: n.lower())


def safe_folder_path(folder: str):
    safe_segments = [sanitize_filename(seg) for seg in folder.replace("\\", "/").split("/") if seg.strip()]
    if not safe_segments:
        raise ValueError("Folder name is empty")
    user_id = getattr(_request_context, "user_id", None)
    scan_root = get_scan_root(user_id)
    dest = scan_root
    for seg in safe_segments:
        dest = dest / seg
    candidate = dest.resolve()
    if scan_root not in candidate.parents and candidate != scan_root:
        raise ValueError("Unsafe folder path")
    return candidate, "/".join(safe_segments)


def find_translation_file(source_path: Path, root=None):
    source_base = group_key(classify_document(source_path)[0])
    candidates = []
    fuzzy_candidates = []
    for path in iter_document_files(include_reader_translations=True, root=root):
        if path.resolve() == source_path.resolve():
            continue
        base, is_translation = classify_document(path)
        if is_translation and group_key(base) == source_base:
            candidates.append(path)
        if source_path.suffix.lower() == ".pdf" and group_key(base) == source_base and path.suffix.lower() != ".pdf":
            candidates.append(path)
        elif is_translation:
            score = fuzzy_translation_score(source_path, path)
            if score >= 0.45:
                fuzzy_candidates.append((score, path))
    if not candidates:
        if not fuzzy_candidates:
            return None
        best_score = max(score for score, _ in fuzzy_candidates)
        candidates = [path for score, path in fuzzy_candidates if score == best_score]
    return sorted(set(candidates), key=translation_sort_key)[0]


_scan_cache = {"mtime": 0, "papers": []}


def invalidate_scan_cache():
    _scan_cache.clear()
    _scan_cache["mtime"] = 0
    _scan_cache["papers"] = []


def scan_papers(scope=None):
    ensure_dirs()
    user_id = getattr(_request_context, "user_id", None)
    # scope="public" forces ROOT_DIR even for logged-in users
    if scope == "public":
        scan_root = ROOT_DIR
        effective_user_id = None
    else:
        scan_root = get_scan_root(user_id)
        effective_user_id = user_id
    # Check if directory has changed since last scan
    try:
        current_mtime = scan_root.stat().st_mtime
    except OSError:
        current_mtime = 0
    # Cache by scan_root to support per-user directories
    cache_key = str(scan_root)
    cached = _scan_cache.get(cache_key)
    if cached and cached.get("mtime") == current_mtime:
        papers = cached["papers"]
        if effective_user_id:
            read_status = get_user_read_status(effective_user_id)
            for p in papers:
                p["read"] = bool(read_status.get(p["id"]))
                p["readAt"] = read_status.get(p["id"], {}).get("updatedAt") if isinstance(read_status.get(p["id"]), dict) else None
        return papers
    if effective_user_id:
        read_status = get_user_read_status(effective_user_id)
        library_state = get_user_library_state(effective_user_id)
    else:
        read_status = read_json(READ_STATUS_PATH, {})
        library_state = read_json(LIBRARY_STATE_PATH, {})
        library_state.setdefault("folders", [])
        library_state.setdefault("hidden", [])
        library_state.setdefault("names", {})
        library_state.setdefault("translations", {})
    hidden = set(library_state.get("hidden", []))
    virtual_folders = set(library_state.get("folders", []))
    display_names = library_state.get("names", {})
    manual_translations = library_state.get("translations", {})
    papers = []
    groups = {}
    for path in iter_document_files(include_reader_translations=True, root=scan_root):
        try:
            rel = path.relative_to(scan_root).as_posix()
        except ValueError:
            rel = ""
        if rel in hidden:
            continue
        base, is_translation = classify_document(path)
        key = group_key(base)
        groups.setdefault(key, {"base": base, "originals": [], "translations": []})
        bucket = "translations" if is_translation else "originals"
        groups[key][bucket].append(path)

    for group in sorted(groups.values(), key=lambda item: item["base"].lower()):
        originals = [path for path in group["originals"] if path.suffix.lower() in ORIGINAL_EXTS]
        if not originals:
            continue
        path = sorted(
            originals,
            key=lambda p: (TRANSLATION_PRIORITY.get(p.suffix.lower(), 99), p.name.lower()),
        )[0]
        rel_path = path.relative_to(scan_root).as_posix()
        if rel_path in hidden:
            continue
        stat = path.stat()
        paper_id = safe_id(rel_path)
        display_name = display_names.get(rel_path) or path.name
        title = Path(display_name).stem
        translations = sorted(
            group["translations"],
            key=translation_sort_key,
        )
        if not translations and path.suffix.lower() == ".pdf":
            translations = [
                candidate
                for candidate in group["originals"]
                if candidate.resolve() != path.resolve() and candidate.suffix.lower() != ".pdf"
            ]
            translations = sorted(
                translations,
                key=translation_sort_key,
            )
        manual_translation = manual_translations.get(rel_path)
        translation_path = (scan_root / manual_translation).resolve() if manual_translation else None
        if translation_path and (not translation_path.exists() or scan_root not in translation_path.parents):
            translation_path = None
        if not translation_path:
            translation_path = translations[0] if translations else find_translation_file(path, root=scan_root)
        physical_folder = rel_path.rsplit("/", 1)[0] if "/" in rel_path else ""
        virtual_folder = physical_folder
        paper = {
            "id": paper_id,
            "title": title,
            "fileName": display_name,
            "originalFileName": path.name,
            "relPath": rel_path,
            "folder": virtual_folder,
            "ext": path.suffix.lower(),
            "size": stat.st_size,
            "modifiedAt": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
            "url": f"/files/{rel_path}",
            "translation": file_payload(translation_path) if translation_path else None,
            "read": bool(read_status.get(paper_id)),
            "readAt": read_status.get(paper_id, {}).get("updatedAt") if isinstance(read_status.get(paper_id), dict) else None,
        }
        papers.append(paper)
    write_json(MANIFEST_PATH, papers)
    _scan_cache[cache_key] = {"mtime": current_mtime, "papers": papers}
    # Backward compatibility: keep old cache key for anonymous access
    if not effective_user_id:
        _scan_cache["mtime"] = current_mtime
        _scan_cache["papers"] = papers
    return papers


def paragraphize(text: str):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    chunks = re.split(r"\n\s*\n+", text)
    paragraphs = []
    for chunk in chunks:
        line = re.sub(r"[ \t]+", " ", chunk.replace("\n", " ")).strip()
        if line:
            paragraphs.append(line)
    return paragraphs or ([text.strip()] if text.strip() else [])


def extract_pdf(path: Path):
    if fitz is None:
        return [
            {
                "page": 1,
                "english": ["PyMuPDF is not available, so PDF text could not be extracted."],
                "chinese": [""],
            }
        ]
    pages = []
    with fitz.open(path) as doc:
        for index, page in enumerate(doc, start=1):
            text = page.get_text("text")
            english = paragraphize(text)
            pages.append({"page": index, "english": english, "chinese": [""] * len(english)})
    return pages


def extract_text_file(path: Path):
    text = path.read_text(encoding="utf-8", errors="ignore")
    return [{"page": 1, "english": paragraphize(text), "chinese": []}]


_TITLE_SKIP = re.compile(
    r"^(abstract|http|https|doi|arxiv|received|accepted|published|revised|available|keywords|©|†|‡|§|\*corresponding|e-?mail|@)",
    re.IGNORECASE,
)
_TITLE_NOISE = re.compile(r"^[\d\s\W]+$")  # lines that are only numbers/symbols/spaces


def _is_valid_title(title: str) -> bool:
    """Check if a string looks like a real paper title, not a DOI/arXiv/journal ID."""
    lower = title.lower()
    # DOIs
    if lower.startswith("doi:") or lower.startswith("doi "):
        return False
    if re.match(r"^10\.\d{4,}/", title):
        return False
    # arXiv identifiers
    if lower.startswith("arxiv:"):
        return False
    # URLs
    if lower.startswith("http:") or lower.startswith("https:"):
        return False
    # Journal article IDs with page ranges (e.g., "jz7b00358 1..8", "cs5b00265 1..8")
    if re.match(r"^[a-z]+\w*\d+\s+\d+\.\.\d+", lower):
        return False
    return True


def extract_pdf_title(path: Path) -> str:
    if fitz is None:
        return path.stem
    try:
        with fitz.open(path) as doc:
            meta_title = (doc.metadata.get("title") or "").strip()
            if meta_title and len(meta_title) > 3 and not meta_title.lower().startswith(("untitled", "microsoft", "word")):
                if _is_valid_title(meta_title):
                    return meta_title.lower()

            if doc.page_count == 0:
                return path.stem

            page = doc[0]
            blocks = page.get_text("dict")["blocks"]

            spans_by_size = {}
            for block in blocks:
                if block.get("type") != 0:
                    continue
                for line in block["lines"]:
                    for span in line["spans"]:
                        text = span["text"].strip()
                        if not text:
                            continue
                        size = round(span["size"], 1)
                        spans_by_size.setdefault(size, []).append({
                            "text": text,
                            "y0": span["bbox"][1],
                            "x0": span["bbox"][0],
                        })

            if spans_by_size:
                max_size = max(spans_by_size.keys())
                title_spans = sorted(spans_by_size[max_size], key=lambda s: (s["y0"], s["x0"]))
                title_text = " ".join(s["text"] for s in title_spans).strip()
                title_text = re.sub(r"\s+", " ", title_text)
                if len(title_text) >= 5 and len(title_text) <= 500:
                    if _is_valid_title(title_text) and not _TITLE_SKIP.match(title_text) and not _TITLE_NOISE.match(title_text):
                        return title_text[:200].lower()

            first_text = page.get_text("text")
            for line in first_text.splitlines():
                line = line.strip()
                if len(line) < 10 or len(line) > 300:
                    continue
                if _TITLE_SKIP.match(line):
                    continue
                if _TITLE_NOISE.match(line):
                    continue
                if line.count(",") >= 3 and len(line) / max(line.count(","), 1) < 20:
                    continue
                return line[:200].lower()
    except Exception:
        pass
    return path.stem.lower()


def extract_pdf_metadata(path: Path) -> dict:
    """提取 PDF 的英文标题和作者列表（保留原始大小写）"""
    result = {"title": "", "authors": []}
    if fitz is None:
        result["title"] = path.stem
        return result
    try:
        with fitz.open(path) as doc:
            # 1. 从 metadata 获取标题（不转小写）
            meta_title = (doc.metadata.get("title") or "").strip()
            if meta_title and len(meta_title) > 3 and not meta_title.lower().startswith(("untitled", "microsoft", "word")):
                if _is_valid_title(meta_title):
                    result["title"] = meta_title

            # 2. 从 metadata 获取作者
            meta_author = (doc.metadata.get("author") or "").strip()
            if meta_author:
                # 按常见分隔符拆分
                import re as _re
                authors = _re.split(r"[;]|(?:\s+and\s+)", meta_author)
                cleaned = []
                for a in authors:
                    parts = [p.strip() for p in a.split(",") if p.strip()]
                    cleaned.extend(parts)
                result["authors"] = [a for a in cleaned if len(a) > 1 and len(a) < 100]

            # 3. 标题回退：用字号分析法（保留原始大小写）
            if not result["title"]:
                if doc.page_count > 0:
                    page = doc[0]
                    blocks = page.get_text("dict")["blocks"]
                    spans_by_size = {}
                    for block in blocks:
                        if block.get("type") != 0:
                            continue
                        for line in block["lines"]:
                            for span in line["spans"]:
                                text = span["text"].strip()
                                if not text:
                                    continue
                                size = round(span["size"], 1)
                                spans_by_size.setdefault(size, []).append({
                                    "text": text,
                                    "y0": span["bbox"][1],
                                    "x0": span["bbox"][0],
                                })
                    if spans_by_size:
                        max_size = max(spans_by_size.keys())
                        title_spans = sorted(spans_by_size[max_size], key=lambda s: (s["y0"], s["x0"]))
                        title_text = " ".join(s["text"] for s in title_spans).strip()
                        title_text = re.sub(r"\s+", " ", title_text)
                        if 5 <= len(title_text) <= 500:
                            if _is_valid_title(title_text) and not _TITLE_SKIP.match(title_text) and not _TITLE_NOISE.match(title_text):
                                result["title"] = title_text[:200]

            # 4. 作者回退：扫描第一页第二大字号行（标题和摘要之间）
            if not result["authors"] and doc.page_count > 0:
                page = doc[0]
                blocks = page.get_text("dict")["blocks"]
                spans_by_size = {}
                for block in blocks:
                    if block.get("type") != 0:
                        continue
                    for line in block["lines"]:
                        for span in line["spans"]:
                            text = span["text"].strip()
                            if not text:
                                continue
                            size = round(span["size"], 1)
                            spans_by_size.setdefault(size, []).append({
                                "text": text,
                                "y0": span["bbox"][1],
                                "x0": span["bbox"][0],
                            })
                if len(spans_by_size) >= 2:
                    sorted_sizes = sorted(spans_by_size.keys(), reverse=True)
                    # 跳过最大字号（标题），取第二大字号
                    second_size = sorted_sizes[1]
                    author_spans = sorted(spans_by_size[second_size], key=lambda s: (s["y0"], s["x0"]))
                    # 收集连续的第二大字号行，直到遇到摘要等停止词
                    author_lines = []
                    for sp in author_spans:
                        txt = sp["text"]
                        if _TITLE_SKIP.match(txt):
                            break
                        # 作者行通常包含逗号、大写字母、数字（上标标记）
                        if re.search(r"[A-Z]", txt) or re.search(r"[,;]", txt):
                            author_lines.append(txt)
                    if author_lines:
                        # 合并同一行的多个 span
                        raw = " ".join(author_lines)
                        # 清理上标标记（数字、星号、剑号）
                        raw = re.sub(r"[\d\*†‡§¶]+", "", raw)
                        raw = re.sub(r"\s+", " ", raw).strip()
                        # 按逗号分割得到作者列表
                        parts = [p.strip() for p in raw.split(",") if p.strip()]
                        result["authors"] = [a for a in parts if 2 < len(a) < 80]

    except Exception:
        pass
    if not result["title"]:
        result["title"] = path.stem
    return result


def ai_extract_pdf_title(path: Path, config: dict) -> str:
    if fitz is None:
        return ""
    try:
        with fitz.open(path) as doc:
            if doc.page_count == 0:
                return ""
            text = doc[0].get_text("text")[:3000]
    except Exception:
        return ""
    if not text.strip():
        return ""

    system_prompt = (
        "从以下学术论文第一页文本中，提取论文的正式标题。\n"
        "严格规则：\n"
        "- 绝对不要输出 DOI（如 10.xxxx/xxxxx 格式的字符串）\n"
        "- 绝对不要输出 URL 网址\n"
        "- 绝对不要输出期刊名称（如 Journal of Catalysis, Chemical Physics Letters 等）\n"
        "- 绝对不要输出页码、卷号、日期\n"
        "- 标题通常在页面最上方、作者姓名之前\n"
        "- 只输出标题本身，不要加引号、编号或任何前缀后缀"
    )

    base_url = normalize_base_url(config["base_url"])
    try:
        if is_anthropic_api(base_url):
            if Anthropic is None:
                return ""
            client = Anthropic(api_key=config["api_key"], base_url=base_url)
            response = client.messages.create(
                model=config["model"],
                max_tokens=256,
                system=system_prompt,
                messages=[{"role": "user", "content": text}],
                temperature=0.1,
            )
            result = ""
            for block in response.content:
                if hasattr(block, "text") and block.type == "text":
                    result = block.text.strip()
                    break
        else:
            if OpenAI is None:
                return ""
            client = OpenAI(api_key=config["api_key"], base_url=base_url)
            response = client.chat.completions.create(
                model=config["model"],
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text},
                ],
                temperature=0.1,
                max_tokens=256,
            )
            result = response.choices[0].message.content.strip()
        print(f"[ai_extract_title] result={result!r}", flush=True)
        if re.match(r"10\.\d{4,}", result):
            print(f"[ai_extract_title] WARNING: got DOI, discarding", flush=True)
            return ""
        return result.lower()
    except Exception as e:
        print(f"[ai_extract_title] ERROR: {e}", flush=True)
        return ""


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name[:200] or "untitled"


def get_translate_config(query=""):
    params = {}
    for part in query.split("&"):
        if "=" in part:
            k, v = part.split("=", 1)
            params[k] = unquote(v)

    api_key = params.get("api_key", "") or TRANSLATE_API_KEY
    if not api_key:
        return None
    return {
        "api_key": api_key,
        "base_url": params.get("base_url", "") or TRANSLATE_BASE_URL,
        "model": params.get("model", "") or TRANSLATE_MODEL,
    }


def chunk_pages(pages, chunk_size=TRANSLATE_CHUNK_SIZE):
    chunks = []
    for i in range(0, len(pages), chunk_size):
        group = pages[i : i + chunk_size]
        text_parts = []
        for page in group:
            page_num = page["page"]
            body = "\n\n".join(page["english"])
            text_parts.append(f"--- Page {page_num} ---\n{body}")
        chunks.append({"start_page": group[0]["page"], "text": "\n\n".join(text_parts)})
    return chunks


def normalize_base_url(url):
    """Normalize base_url: strip trailing slash only."""
    return url.rstrip("/")


def is_anthropic_api(base_url):
    """Check if the API uses Anthropic format."""
    return "anthropic" in base_url.lower()


def call_translate_api(chunk_text, config, context_hint=""):
    system_prompt = (
        "你是一位专业的学术论文翻译助手。请将以下英文学术论文内容翻译为中文。\n\n"
        "## 输出要求\n"
        "- 输出读者可直接阅读的学术中文译文，不是摘要或提要\n"
        "- 保留作者姓名原文，不翻译\n"
        "- 翻译机构/单位信息为中文\n"
        "- 章节标题同时保留英文和中文，格式如：## 1. Introduction / 1. 引言\n\n"
        "## 翻译规则\n"
        "- 根据论文学科领域使用该领域标准的学术中文表达\n"
        "- 保留源段落结构：一个英文段落对应一个中文段落，段落之间空一行\n"
        "- 保留所有数学公式、化学式、变量符号、下标、上标、单位、引用编号、方程编号\n"
        "- 全文技术术语保持一致\n"
        "- 使用中文散文表达，不用要点式摘要（除非原文本身就是列表）\n"
        "- 不要编造数据、图题、作者信息或机构声明\n"
        "- 保留图表引用格式（如 Figure 1、Table 2、Scheme 1）\n\n"
        "## 格式要求（严格遵守）\n"
        "- 每一个章节标题都必须翻译并用 ## 标记，绝对不能省略任何章节标题\n"
        "- 段落之间必须用空行分隔，绝对不能把两个段落合并成一个\n"
        "- 图题和表题必须翻译为中文，格式如：图 1. 中文图题 / 表 1. 中文表题\n"
        "- 图题和表题必须出现在原文中对应的位置（紧跟在图表引用之后），不能丢失或移动\n"
        "- 参考文献部分只输出标题 \"## References / 参考文献\"，不要输出参考文献的具体内容\n"
        "- 论文标题和作者信息由系统自动处理，翻译时跳过标题行和作者行，直接从正文开始翻译\n"
        "- 第一行 # 标记的标题是你翻译的中文标题，不要在正文中重复出现标题或作者信息\n"
        "- 只输出翻译结果，不要添加解释、注释或说明"
    )
    if context_hint:
        system_prompt += f"\n\n以下是论文的前文内容，供参考上下文和术语一致性：\n{context_hint}"

    base_url = normalize_base_url(config["base_url"])

    try:
        if is_anthropic_api(base_url):
            if Anthropic is None:
                raise RuntimeError("未安装 anthropic 库，请运行 pip install anthropic")
            client = Anthropic(api_key=config["api_key"], base_url=base_url)
            response = client.messages.create(
                model=config["model"],
                max_tokens=8192,
                system=system_prompt,
                messages=[{"role": "user", "content": [{"type": "text", "text": chunk_text}]}],
                temperature=0.3,
            )
            for block in response.content:
                if hasattr(block, "text") and block.type == "text":
                    return block.text
            return ""
        else:
            if OpenAI is None:
                raise RuntimeError("未安装 openai 库，请运行 pip install openai")
            client = OpenAI(api_key=config["api_key"], base_url=base_url)
            response = client.chat.completions.create(
                model=config["model"],
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": chunk_text},
                ],
                temperature=0.3,
                max_tokens=8192,
            )
            return response.choices[0].message.content
    except Exception as e:
        raise RuntimeError(f"API 调用失败 ({config['base_url']} | {config['model']}): {e}")


def render_pages_base64(source_path, start_page, count, scale=2.0):
    """将 PDF 指定页渲染为 base64 JPEG 列表"""
    import base64
    result = []
    with fitz.open(source_path) as doc:
        for i in range(start_page - 1, min(start_page - 1 + count, doc.page_count)):
            page = doc.load_page(i)
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            jpg_bytes = pix.tobytes("jpeg")
            b64 = base64.b64encode(jpg_bytes).decode("ascii")
            result.append({"page": i + 1, "b64": b64})
    return result


def _detect_column_layout(page, blocks):
    """检测页面是否为双栏布局，返回 (is_two_col, col_divider_x, left_x, right_x, right_w)"""
    text_blocks = [b for b in blocks if b.get("type") == 0 and b.get("lines")]
    if len(text_blocks) < 6:
        return False, None, 0, 0, 0
    # 统计文本块的 x 坐标分布
    left_xs = [b["bbox"][0] for b in text_blocks if b["bbox"][0] < page.rect.width * 0.45]
    right_xs = [b["bbox"][0] for b in text_blocks if b["bbox"][0] > page.rect.width * 0.5]
    if len(left_xs) > 2 and len(right_xs) > 2:
        left_x = min(left_xs)
        right_x = min(right_xs)
        divider = (max(left_xs) + right_x) / 2
        return True, divider, left_x, right_x, page.rect.width - right_x
    return False, None, 0, 0, 0


def _crop_and_encode(page, rect, scale):
    """裁剪区域并编码为 base64 JPEG，验证裁剪质量"""
    import base64
    # 确保裁剪区域有效
    if rect.is_empty or rect.is_infinite:
        return None
    width = rect.width
    height = rect.height
    # 最小尺寸检查：太小的裁剪没有意义
    if width < 30 or height < 30:
        return None
    # 宽高比检查：极端比例说明裁剪有问题
    ratio = max(width, height) / max(min(width, height), 1)
    if ratio > 15:
        return None
    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=rect, alpha=False)
        jpg_bytes = pix.tobytes("jpeg")
        # 文件大小检查：太小说明可能裁到了空白区域
        if len(jpg_bytes) < 500:
            return None
        return base64.b64encode(jpg_bytes).decode("ascii")
    except Exception:
        return None


def _merge_rects(rects, gap=10):
    """合并间距 < gap 的重叠矩形"""
    if not rects:
        return None
    merged = fitz.Rect(rects[0])
    for r in rects[1:]:
        expanded = fitz.Rect(merged.x0 - gap, merged.y0 - gap, merged.x1 + gap, merged.y1 + gap)
        if expanded.intersects(r):
            merged |= r
    return merged


def _find_best_crop_region(caption, image_blocks, drawing_rects, col_x0, col_x1, prev_bottom):
    """根据 caption 位置，找到最紧密的裁剪区域。

    优先级：图片块 > 矢量图形聚类 > 回退到文本布局法（返回 None）
    """
    cap_y0 = caption["y0"]
    col_margin = 10

    # 策略 1：找 caption 上方同列的 image block
    matching_imgs = []
    for img in image_blocks:
        if img["x0"] >= col_x0 - col_margin and img["x1"] <= col_x1 + col_margin:
            if img["y1"] <= cap_y0 + 5 and img["y0"] >= prev_bottom - 10:
                matching_imgs.append(img)
    if matching_imgs:
        top = max(min(img["y0"] for img in matching_imgs) - 5, prev_bottom)
        bottom = max(img["y1"] for img in matching_imgs) + 3
        left = max(min(img["x0"] for img in matching_imgs) - 3, col_x0)
        right = min(max(img["x1"] for img in matching_imgs) + 3, col_x1)
        if bottom - top > 20:
            return fitz.Rect(left, top, right, bottom)

    # 策略 2：找 caption 上方的矢量图形簇
    col_drawings = []
    for r in drawing_rects:
        if r.x0 >= col_x0 - col_margin and r.x1 <= col_x1 + col_margin:
            if r.y1 <= cap_y0 + 5 and r.y0 >= prev_bottom - 10:
                if r.width > 15 and r.height > 15:
                    col_drawings.append(r)
    if len(col_drawings) >= 3:
        merged = _merge_rects(col_drawings)
        if merged and merged.height > 30:
            return fitz.Rect(
                max(merged.x0 - 3, col_x0),
                max(merged.y0 - 3, prev_bottom),
                min(merged.x1 + 3, col_x1),
                min(merged.y1 + 3, cap_y0 - 2),
            )

    # 策略 3：回退
    return None


def detect_figures_and_tables(source_path, start_page, count, scale=2.0):
    """检测 PDF 页面中的图表、表格、公式，精确裁剪并返回 base64 列表"""
    import re
    caption_re = re.compile(
        r"^(Fig(?:ure)?\.?\s*\d+|Figure\s+\d+|Table\s+\d+|Scheme\s+\d+|图表?\s*\d+|表\s*\d+)",
        re.IGNORECASE,
    )
    # 公式检测：带编号的独立公式行，如 (1), (2), Eq. (3)
    equation_re = re.compile(r"^\s*\(?\d+\)?\s*$|^Eq\.?\s*\(?\d+\)?", re.IGNORECASE)
    results = []
    with fitz.open(source_path) as doc:
        for page_idx in range(start_page - 1, min(start_page - 1 + count, doc.page_count)):
            page = doc.load_page(page_idx)
            page_rect = page.rect
            page_dict = page.get_text("dict")
            blocks = page_dict["blocks"]

            # 检测双栏布局
            is_two_col, col_div, left_x, right_x, right_w = _detect_column_layout(page, blocks)

            # 收集图片块（type 1）和矢量绘图元素
            image_blocks = []
            for block in blocks:
                if block.get("type") == 1:
                    bx0, by0, bx1, by1 = block["bbox"]
                    # 跳过覆盖页面 >90% 的超大图片（可能是背景）
                    area_ratio = (bx1 - bx0) * (by1 - by0) / (page_rect.width * page_rect.height)
                    if area_ratio < 0.9:
                        image_blocks.append({"x0": bx0, "y0": by0, "x1": bx1, "y1": by1})
            try:
                drawings = page.get_drawings()
            except Exception:
                drawings = []
            drawing_rects = []
            for d in drawings:
                r = d.get("rect")
                if r and r.is_valid and not r.is_empty:
                    drawing_rects.append(r)

            # 收集所有文本行及其位置
            all_lines = []
            for block in blocks:
                if block.get("type") != 0:
                    continue
                bx0, by0, bx1, by1 = block["bbox"]
                for line in block.get("lines", []):
                    text = "".join(span["text"] for span in line.get("spans", []))
                    lx0, ly0, lx1, ly1 = line["bbox"]
                    all_lines.append({
                        "text": text.strip(),
                        "bbox": line["bbox"],
                        "x0": lx0, "y0": ly0, "x1": lx1, "y1": ly1,
                        "block_bbox": block["bbox"],
                    })

            # 找到所有 caption
            captions = []
            for ln in all_lines:
                if caption_re.match(ln["text"]):
                    captions.append(ln)
            if not captions:
                continue
            captions.sort(key=lambda c: c["y0"])

            # 找到公式行（居中的短行，带编号）
            equation_lines = []
            for ln in all_lines:
                if equation_re.match(ln["text"]) and (ln["x1"] - ln["x0"]) < page_rect.width * 0.5:
                    equation_lines.append(ln)

            # 为每个 caption 裁剪对应的图表/表格区域
            # caption 的位置标记了图表的下方边界
            # 图表区域在 caption 上方，到前一个元素（正文/图表）的下方边界
            # 需要确定 caption 所在的列
            prev_bottoms = {"left": 0, "right": 0} if is_two_col else {"full": 0}

            for cap in captions:
                cap_x0 = cap["x0"]
                cap_y0 = cap["y0"]

                # 确定所在列
                if is_two_col:
                    if cap_x0 < col_div:
                        col_key = "left"
                        col_x0 = left_x
                        col_x1 = col_div
                    else:
                        col_key = "right"
                        col_x0 = right_x
                        col_x1 = page_rect.width
                else:
                    col_key = "full"
                    col_x0 = 0
                    col_x1 = page_rect.width

                crop_top = prev_bottoms.get(col_key, 0)
                crop_bottom = cap_y0

                # 裁剪区域：caption 上方、前一个元素下方
                if crop_bottom - crop_top < 20:
                    prev_bottoms[col_key] = cap_y0 + 30
                    continue

                # 优先用图片块/矢量图形精确定位裁剪区域
                tight_clip = _find_best_crop_region(cap, image_blocks, drawing_rects, col_x0, col_x1, crop_top)
                if tight_clip:
                    clip = tight_clip
                else:
                    # 回退：文本布局法，不包含原 caption
                    clip = fitz.Rect(col_x0, crop_top - 3, col_x1, crop_bottom - 2)
                b64 = _crop_and_encode(page, clip, scale)
                if b64:
                    results.append({
                        "page": page_idx + 1,
                        "caption": cap["text"],
                        "type": "figure" if re.match(r"(?i)(Fig|Scheme|图)", cap["text"]) else "table",
                        "b64": b64,
                    })
                prev_bottoms[col_key] = cap_y0 + 30

            # 检测独立公式（带编号的居中公式行）
            for eq_line in equation_lines:
                eq_y = eq_line["y0"]
                # 公式行上方找公式主体（通常是较大的居中行）
                eq_candidates = [ln for ln in all_lines
                                 if ln["y0"] < eq_y and ln["y0"] > eq_y - 80
                                 and abs((ln["x0"] + ln["x1"]) / 2 - page_rect.width / 2) < page_rect.width * 0.3
                                 and ln["y1"] - ln["y0"] > 10]
                if eq_candidates:
                    eq_top = min(ln["y0"] for ln in eq_candidates) - 5
                    eq_bottom = eq_line["y1"] + 5
                    if is_two_col:
                        if eq_line["x0"] < col_div:
                            eq_x0, eq_x1 = left_x, col_div
                        else:
                            eq_x0, eq_x1 = right_x, page_rect.width
                    else:
                        eq_x0, eq_x1 = 0, page_rect.width
                    clip = fitz.Rect(eq_x0, eq_top, eq_x1, eq_bottom)
                    b64 = _crop_and_encode(page, clip, scale)
                    if b64:
                        results.append({
                            "page": page_idx + 1,
                            "caption": eq_line["text"],
                            "type": "equation",
                            "b64": b64,
                        })
    return results


def qa_check_translation(paper, translated_text):
    """对翻译结果进行 QA 检查，返回问题列表"""
    issues = []
    # 检查标题
    if not re.search(r"^#\s+.+", translated_text, re.MULTILINE):
        issues.append("缺少标题")
    # 检查中英双语标题
    lines = translated_text.strip().split("\n")
    title_lines = [l for l in lines[:5] if l.startswith("# ")]
    has_en = any(re.search(r"[a-zA-Z]{3,}", l) for l in title_lines)
    has_zh = any(re.search(r"[一-鿿]{2,}", l) for l in title_lines)
    if title_lines and (not has_en or not has_zh):
        issues.append("标题可能缺少中英双语")
    # 检查摘要
    if not re.search(r"(?i)(abstract|摘要)", translated_text):
        issues.append("缺少摘要部分")
    # 检查乱码
    if re.search(r"[�□]{2,}", translated_text):
        issues.append("检测到可能的乱码或编码损坏")
    # 检查未翻译的占位符
    if re.search(r"\?{3,}", translated_text):
        issues.append("检测到连续问号，可能有翻译失败的内容")
    # 检查参考文献是否保留原文
    ref_section = re.search(r"(?i)(references|参考文献)([\s\S]+)$", translated_text)
    if ref_section:
        ref_text = ref_section.group(2)
        zh_chars = len(re.findall(r"[一-鿿]", ref_text))
        total_chars = len(ref_text.strip())
        if total_chars > 100 and zh_chars / total_chars > 0.3:
            issues.append("参考文献部分可能被翻译了")
    # 检查章节标题是否翻译
    section_headings = re.findall(r"^##\s+(.+)$", translated_text, re.MULTILINE)
    if section_headings:
        untranslated = [h for h in section_headings if not re.search(r"[一-鿿]", h)]
        if len(untranslated) > len(section_headings) * 0.5:
            issues.append("多个章节标题可能未翻译")
    # 检查图题/表题格式
    caption_count = len(re.findall(r"^图\s*\d+[a-z]?\s*[.．:：]|^表\s*\d+[a-z]?\s*[.．:：]", translated_text, re.MULTILINE))
    if caption_count == 0:
        issues.append("未找到中文图题（图 X. / 表 X.），请检查图题翻译格式")
    return issues


def _find_figure_by_num(figures, num_str):
    """根据编号精确匹配图表，支持子图编号（1a, 2b），避免子串误匹配"""
    import re
    m = re.match(r"(\d+)([a-z])?", num_str)
    if not m:
        return -1, None
    num = m.group(1)
    suffix = m.group(2) or ""

    # 第一轮：精确匹配完整编号（如 "1a" ↔ "Figure 1a"）
    for j, fig in enumerate(figures):
        fig_cap = fig.get("caption", "")
        if re.search(r'\b' + re.escape(num_str) + r'\b', fig_cap, re.IGNORECASE):
            return j, fig

    # 第二轮：仅数字匹配（如 "1" ↔ "Figure 1"，不匹配 "10"）
    if not suffix:
        for j, fig in enumerate(figures):
            fig_cap = fig.get("caption", "")
            if re.search(r'\b' + re.escape(num) + r'\b', fig_cap):
                return j, fig

    # 第三轮：子图回退（如 "1a" → 降级匹配 "Figure 1"）
    if suffix:
        for j, fig in enumerate(figures):
            fig_cap = fig.get("caption", "")
            if re.search(r'\b' + re.escape(num) + r'\b', fig_cap):
                return j, fig

    return -1, None


def build_translation_markdown(paper, translated_chunks, pdf_meta=None):
    import re
    if pdf_meta is None:
        pdf_meta = {"title": paper.get("title", ""), "authors": []}
    # 合并所有译文 chunk
    full_text = "\n\n".join(translated_chunks)
    # 从译文中提取中文标题（第一行以 # 开头的）
    lines = full_text.split("\n")
    translated_title = ""
    for ln in lines[:10]:
        m = re.match(r"^#\s+(.+)", ln.strip())
        if m:
            translated_title = m.group(1)
            break
    # 移除译文中的重复标题行（避免标题出现两次）
    cleaned_lines = []
    title_removed = False
    for ln in lines:
        if not title_removed and re.match(r"^#\s+", ln.strip()):
            title_removed = True
            continue
        cleaned_lines.append(ln)
    full_text = "\n".join(cleaned_lines)
    # 参考文献：只保留标题行，移除具体内容
    ref_pattern = re.compile(r"^(##?\s*)?(References|参考文献|Bibliography)\s*$", re.IGNORECASE | re.MULTILINE)
    ref_match = ref_pattern.search(full_text)
    if ref_match:
        ref_heading = full_text[ref_match.start():ref_match.end()]
        full_text = full_text[:ref_match.start()] + "\n\n" + ref_heading + "\n"
    # 构建头部：英文标题 + 中文标题 + 作者
    english_title = pdf_meta.get("title", "") or paper.get("title", "")
    header_parts = [f"# {english_title}"]
    if translated_title and translated_title.strip().lower() != english_title.strip().lower():
        header_parts.append(f"# {translated_title}")
    authors = pdf_meta.get("authors", [])
    if authors:
        header_parts.append(", ".join(authors))
    header = "\n\n".join(header_parts)
    return f"{header}\n\n{full_text}"


def save_translation_file(paper, content):
    source_path = paper_path(paper)
    out_path = source_path.parent / f"{source_path.stem}_academic_translation.md"
    out_path.write_text(content, encoding="utf-8")
    return out_path


def paper_path(paper):
    user_id = getattr(_request_context, "user_id", None)
    # Try personal scope first (must exist)
    scan_root = get_scan_root(user_id)
    candidate = (scan_root / paper["relPath"]).resolve()
    if (scan_root in candidate.parents or candidate == scan_root) and candidate.exists():
        return candidate
    # Fall back to public scope (ROOT_DIR)
    candidate = (ROOT_DIR / paper["relPath"]).resolve()
    if ROOT_DIR in candidate.parents or candidate == ROOT_DIR:
        return candidate
    raise ValueError("Unsafe paper path")


def get_paper(paper_id: str):
    user_id = getattr(_request_context, "user_id", None)
    if user_id:
        # Try personal scope first, then public
        papers = scan_papers()
        for paper in papers:
            if paper["id"] == paper_id:
                return paper
        papers = scan_papers(scope="public")
        for paper in papers:
            if paper["id"] == paper_id:
                return paper
    else:
        papers = _scan_cache["papers"] if _scan_cache["papers"] else scan_papers()
        for paper in papers:
            if paper["id"] == paper_id:
                return paper
    return None


ASK_CONTEXT_LIMITS = {
    "turbo": 2500,
    "quick": 4500,
    "balanced": 9000,
    "full": 30000,
}
_ask_pages_cache = {}
ASK_STOP_WORDS = {
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "have", "has",
    "what", "why", "how", "when", "where", "which", "paper", "article", "论文", "文章", "什么",
    "为什么", "如何", "怎么", "是否", "请问", "这个", "这些", "一下",
}


def ask_keywords(question: str):
    words = re.findall(r"[A-Za-z][A-Za-z0-9_\-]{2,}|[\u4e00-\u9fff]{2,}", question.lower())
    return {word for word in words if word not in ASK_STOP_WORDS}


def trim_to_limit(text: str, limit: int):
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n...[context truncated]"


def get_ask_pages(paper, source_path: Path):
    stat = source_path.stat()
    cache_key = str(source_path.resolve())
    cached = _ask_pages_cache.get(cache_key)
    if cached and cached.get("mtime") == stat.st_mtime and cached.get("size") == stat.st_size:
        return cached["pages"]
    pages = extract_pdf(source_path) if paper["ext"] == ".pdf" else extract_text_file(source_path)
    _ask_pages_cache[cache_key] = {
        "mtime": stat.st_mtime,
        "size": stat.st_size,
        "pages": pages,
    }
    if len(_ask_pages_cache) > 24:
        oldest_key = next(iter(_ask_pages_cache))
        _ask_pages_cache.pop(oldest_key, None)
    return pages


def build_ask_context(paper, source_path: Path, question: str, mode: str):
    mode = mode if mode in ASK_CONTEXT_LIMITS else "balanced"
    limit = ASK_CONTEXT_LIMITS[mode]
    pages = get_ask_pages(paper, source_path)
    chunks = []
    for page in pages:
        for para in page.get("english", []):
            para = re.sub(r"\s+", " ", para).strip()
            if para:
                chunks.append({"page": page["page"], "text": para})

    if not chunks:
        return ""

    if mode == "full":
        full_text = "\n".join(f"[Page {item['page']}] {item['text']}" for item in chunks)
        return trim_to_limit(full_text, limit)

    keywords = ask_keywords(question)
    if mode == "turbo":
        base_limit = 600
        top_n = 5
    elif mode == "quick":
        base_limit = 1200
        top_n = 8
    else:
        base_limit = 2800
        top_n = 14
    selected = []
    used = set()
    used_chars = 0

    for idx, item in enumerate(chunks):
        if used_chars >= base_limit:
            break
        selected.append((idx, item, 999))
        used.add(idx)
        used_chars += len(item["text"]) + 16

    scored = []
    for idx, item in enumerate(chunks):
        if idx in used:
            continue
        text = item["text"].lower()
        score = sum(text.count(word) for word in keywords)
        if score:
            scored.append((score, idx, item))

    scored.sort(key=lambda row: (-row[0], row[1]))
    for score, idx, item in scored[:top_n]:
        selected.append((idx, item, score))

    selected.sort(key=lambda row: row[0])
    context = "\n".join(f"[Page {item['page']}] {item['text']}" for _, item, _ in selected)
    return trim_to_limit(context, limit)


def preview_payload(paper):
    source_path = paper_path(paper)
    read_status = read_read_status()
    # Use translation already found by scan_papers() if available
    if not paper.get("translation"):
        user_id = getattr(_request_context, "user_id", None)
        translation_path = find_translation_file(source_path, root=get_scan_root(user_id))
        paper["translation"] = file_payload(translation_path) if translation_path else None
    paper["url"] = f"/files/{paper['relPath']}"
    paper["read"] = bool(read_status.get(paper["id"]))
    paper["readAt"] = read_status.get(paper["id"], {}).get("updatedAt") if isinstance(read_status.get(paper["id"]), dict) else None
    return {
        "paper": paper,
        "original": file_payload(source_path),
        "translation": paper["translation"],
    }


def pdf_page_count(paper):
    if fitz is None:
        raise RuntimeError("PyMuPDF is not available")
    source_path = paper_path(paper)
    with fitz.open(source_path) as doc:
        return doc.page_count


def rendered_pdf_page(paper, page_number: int):
    if fitz is None:
        raise RuntimeError("PyMuPDF is not available")
    source_path = paper_path(paper)
    source_mtime = int(source_path.stat().st_mtime)
    scale_tag = str(PDF_RENDER_SCALE).replace(".", "p")
    cache_path = RENDERED_DIR / f"{paper['id']}_{source_mtime}_{scale_tag}_{page_number}.jpg"
    if cache_path.exists():
        return cache_path.read_bytes()
    # 只渲染请求的页面，然后后台渲染剩余页面
    with fitz.open(source_path) as doc:
        if page_number < 1 or page_number > doc.page_count:
            raise ValueError("Page out of range")
        page = doc.load_page(page_number - 1)
        pix = page.get_pixmap(matrix=fitz.Matrix(PDF_RENDER_SCALE, PDF_RENDER_SCALE), alpha=False)
        result = pix.tobytes("jpeg")
        cache_path.write_bytes(result)
    # 后台渲染其余页面
    threading.Thread(target=_render_remaining_pages,
                     args=(paper, source_path, source_mtime, scale_tag, page_number),
                     daemon=True).start()
    return result


def _render_remaining_pages(paper, source_path, source_mtime, scale_tag, skip_page):
    """后台渲染除 skip_page 外的所有页面"""
    try:
        with fitz.open(source_path) as doc:
            for i in range(doc.page_count):
                page_num = i + 1
                if page_num == skip_page:
                    continue
                cache_path = RENDERED_DIR / f"{paper['id']}_{source_mtime}_{scale_tag}_{page_num}.jpg"
                if cache_path.exists():
                    continue
                page = doc.load_page(i)
                pix = page.get_pixmap(matrix=fitz.Matrix(PDF_RENDER_SCALE, PDF_RENDER_SCALE), alpha=False)
                cache_path.write_bytes(pix.tobytes("jpeg"))
    except Exception:
        pass


def pdf_text_blocks(paper, page_number: int):
    """提取 PDF 某页的文字块及坐标"""
    if fitz is None:
        raise RuntimeError("PyMuPDF is not available")
    source_path = paper_path(paper)
    with fitz.open(source_path) as doc:
        if page_number < 1 or page_number > doc.page_count:
            raise ValueError("Page out of range")
        page = doc.load_page(page_number - 1)
        page_height = page.rect.height
        blocks = page.get_text("dict")["blocks"]
        words = page.get_text("words")
        result = []
        text_block_items = []
        for block_index, b in enumerate(blocks):
            if b["type"] != 0:
                continue
            block_lines = []
            for line in b["lines"]:
                line_text = "".join(span["text"] for span in line["spans"]).strip()
                if line_text:
                    block_lines.append({
                        "text": line_text,
                        "x0": line["bbox"][0],
                        "y0": line["bbox"][1],
                        "x1": line["bbox"][2],
                        "y1": line["bbox"][3],
                    })
                for span in line["spans"]:
                    text = span["text"].strip()
                    if not text:
                        continue
                    result.append({
                        "text": span["text"],
                        "x": span["origin"][0],
                        "y": span["origin"][1],
                        "size": span["size"],
                    })
            if block_lines:
                text_block_items.append({
                    "block": block_index,
                    "x0": b["bbox"][0],
                    "y0": b["bbox"][1],
                    "x1": b["bbox"][2],
                    "y1": b["bbox"][3],
                    "lines": block_lines,
                })
        word_items = []
        for word in words:
            text = str(word[4]).strip()
            if not text:
                continue
            word_items.append({
                "x0": word[0],
                "y0": word[1],
                "x1": word[2],
                "y1": word[3],
                "text": word[4],
                "block": word[5],
                "line": word[6],
                "word": word[7],
            })
        return {
            "blocks": result,
            "textBlocks": text_block_items,
            "words": word_items,
            "pageWidth": page.rect.width,
            "pageHeight": page_height,
        }


def extracted_payload(paper):
    ensure_dirs()
    extract_path = EXTRACTED_DIR / f"{paper['id']}.json"
    source_path = paper_path(paper)
    source_mtime = source_path.stat().st_mtime
    cached = read_json(extract_path, None)
    if cached and cached.get("sourceModified") == source_mtime:
        payload = cached
    else:
        pages = extract_pdf(source_path) if paper["ext"] == ".pdf" else extract_text_file(source_path)
        payload = {
            "paper": paper,
            "sourceModified": source_mtime,
            "extractedAt": datetime.now().isoformat(timespec="seconds"),
            "pages": pages,
        }
        write_json(extract_path, payload)

    translations = read_json(TRANSLATIONS_DIR / f"{paper['id']}.json", {})
    translated_pages = translations.get("pages", [])
    by_page = {item.get("page"): item for item in translated_pages}
    for page in payload["pages"]:
        saved = by_page.get(page["page"])
        if saved:
            page["chinese"] = saved.get("chinese", page.get("chinese", []))
    return payload


class LiteratureHandler(SimpleHTTPRequestHandler):
    server_version = "LiteratureReader/0.1"

    def translate_path(self, path):
        parsed = urlparse(path)
        clean = unquote(parsed.path.lstrip("/")) or "index.html"
        return str((WEB_DIR / clean).resolve())

    def json_response(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or "0")
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def is_authenticated(self):
        # 首先检查 session token
        cookies = self.headers.get("Cookie", "")
        for cookie in cookies.split(";"):
            cookie = cookie.strip()
            if cookie.startswith("session_token="):
                token = cookie.split("=", 1)[1]
                user = verify_token(token)
                if user:
                    self._current_user = user
                    return True

        # 如果没有设置 AUTH_PASSWORD，则不需要认证
        if not AUTH_PASSWORD:
            return True

        # 检查 Basic Auth
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Basic "):
            return False
        try:
            decoded = base64.b64decode(auth.removeprefix("Basic ").strip()).decode("utf-8")
        except Exception:
            return False
        _, _, password = decoded.partition(":")
        return hmac.compare_digest(password, AUTH_PASSWORD)

    def require_auth(self):
        if self.is_authenticated():
            return True
        body = "Authentication required".encode("utf-8")
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Literature Reader"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return False

    def end_headers(self):  # noqa: N802
        request_path = urlparse(self.path).path
        if request_path.startswith("/api/") or request_path.endswith((".html", ".js", ".mjs", ".css")) or request_path in {"/", ""}:
            self.send_header("Cache-Control", "no-store, max-age=0")
        origin = self.headers.get("Origin", "")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        super().end_headers()

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            # 检查登录状态（不需要 Basic Auth）
            if path == "/api/auth/me":
                user = get_current_user(self)
                if user:
                    self.json_response({"ok": True, "user": user})
                else:
                    self.json_response({"ok": False, "user": None})
                return

            # 以下端点需要认证
            if not self.require_auth():
                return

            # 设置请求上下文（用户数据隔离）
            user = getattr(self, "_current_user", None)
            _request_context.user_id = user["id"] if user else None
            if path == "/api/papers":
                qs = parse_qs(parsed.query)
                scope = qs.get("scope", [None])[0]
                self.json_response({"papers": scan_papers(scope=scope)})
                return
            if path.startswith("/api/papers/"):
                paper_id = path.rsplit("/", 1)[-1]
                paper = get_paper(paper_id)
                if not paper:
                    self.json_response({"error": "Paper not found"}, 404)
                    return
                self.json_response(preview_payload(paper))
                return
            if path.startswith("/api/pdf-pages/"):
                paper_id = path.rsplit("/", 1)[-1]
                paper = get_paper(paper_id)
                if not paper or paper["ext"] != ".pdf":
                    self.json_response({"error": "PDF not found"}, 404)
                    return
                self.json_response({"pages": pdf_page_count(paper)})
                return
            if path.startswith("/api/pdf-file/"):
                paper_id = path.removeprefix("/api/pdf-file/").split("/")[0]
                paper = get_paper(paper_id)
                if not paper or paper["ext"] != ".pdf":
                    self.send_error(404)
                    return
                source_path = paper_path(paper)
                body = source_path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "application/pdf")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if path.startswith("/api/pdf-page/"):
                parts = path.removeprefix("/api/pdf-page/").split("/")
                if len(parts) != 2:
                    self.send_error(404)
                    return
                paper = get_paper(parts[0])
                if not paper or paper["ext"] != ".pdf":
                    self.send_error(404)
                    return
                try:
                    body = rendered_pdf_page(paper, int(parts[1]))
                except (RuntimeError, ValueError):
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "private, max-age=604800")
                self.end_headers()
                self.wfile.write(body)
                return
            if path.startswith("/api/pdf-text/"):
                parts = path.removeprefix("/api/pdf-text/").split("/")
                if len(parts) != 2:
                    self.send_error(404)
                    return
                paper = get_paper(parts[0])
                if not paper or paper["ext"] != ".pdf":
                    self.send_error(404)
                    return
                try:
                    data = pdf_text_blocks(paper, int(parts[1]))
                except (RuntimeError, ValueError):
                    self.send_error(404)
                    return
                body = json.dumps(data, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "private, max-age=604800")
                self.end_headers()
                self.wfile.write(body)
                return
            if path.startswith("/api/text/"):
                rel_path = unquote(path.removeprefix("/api/text/"))
                scan_root = get_scan_root(getattr(_request_context, "user_id", None))
                candidate = (scan_root / rel_path).resolve()
                # Try public scope if not found in personal scope
                if scan_root not in candidate.parents or not candidate.exists():
                    candidate = (ROOT_DIR / rel_path).resolve()
                    if ROOT_DIR not in candidate.parents or not candidate.exists():
                        self.json_response({"error": "File not found"}, 404)
                        return
                if candidate.suffix.lower() not in {".md", ".txt"}:
                    self.json_response({"error": "Text preview is only available for md/txt files"}, 400)
                    return
                self.json_response({"text": candidate.read_text(encoding="utf-8", errors="ignore")})
                return
            if path.startswith("/api/translate/"):
                paper_id = path.rsplit("/", 1)[-1]
                self.handle_translate_sse(paper_id)
                return
            if path.startswith("/api/ask/"):
                paper_id = path.split("/")[3]
                self.handle_ask_sse(paper_id)
                return
            if path.startswith("/api/related/"):
                paper_id = path.rsplit("/", 1)[-1]
                self.handle_related_sse(paper_id)
                return
            if path == "/api/translate-config":
                self.json_response({
                    "default_model": TRANSLATE_MODEL,
                    "default_base_url": TRANSLATE_BASE_URL,
                })
                return
            if path == "/api/folders":
                qs = parse_qs(parsed.query)
                scope = qs.get("scope", [None])[0]
                self.json_response({"folders": list_library_folders(scope=scope)})
                return
            if path == "/api/storage-path":
                users = get_users()
                custom = users.get(user["id"], {}).get("storagePath", "") if user else ""
                self.json_response({"ok": True, "path": custom})
                return
            if path == "/api/user-config":
                if not user:
                    self.json_response({"ok": False, "config": {}})
                    return
                users = get_users()
                cfg = users.get(user["id"], {}).get("apiConfig", {})
                self.json_response({"ok": True, "config": cfg})
                return
            if path == "/api/browse-folder":
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes("-topmost", True)
                folder = filedialog.askdirectory(parent=root, title="选择文献存储文件夹")
                root.destroy()
                self.json_response({"ok": True, "path": folder or ""})
                return
            if path.startswith("/api/annotations/"):
                paper_id = path.rsplit("/", 1)[-1]
                self.json_response(read_annotations(paper_id))
                return
            if path == "/api/comments":
                self.json_response(read_comments())
                return
            if path == "/api/read-status":
                self.json_response(read_read_status())
                return
            if path.startswith("/files/"):
                rel_path = unquote(path.removeprefix("/files/"))
                scan_root = get_scan_root(getattr(_request_context, "user_id", None))
                candidate = (scan_root / rel_path).resolve()
                # Try public scope if not found in personal scope
                if scan_root not in candidate.parents or not candidate.exists():
                    candidate = (ROOT_DIR / rel_path).resolve()
                    if ROOT_DIR not in candidate.parents or not candidate.exists():
                        self.send_error(404)
                        return
                mime = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(candidate.stat().st_size))
                self.end_headers()
                with candidate.open("rb") as f:
                    self.wfile.write(f.read())
                return
            super().do_GET()
        except Exception as e:
            print(f"[ERROR] do_GET {path}: {e}")
            import traceback
            traceback.print_exc()
            try:
                self.json_response({"error": str(e)}, 500)
            except Exception:
                pass

    def sse_send(self, data):
        payload = json.dumps(data, ensure_ascii=False)
        self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
        self.wfile.flush()

    def handle_translate_sse(self, paper_id):
        parsed = urlparse(self.path)
        config = get_translate_config(parsed.query)
        if not config:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.sse_send({"status": "error", "message": "翻译服务未配置。请在设置中填写 API Key。"})
            return

        paper = get_paper(paper_id)
        if not paper:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.sse_send({"status": "error", "message": "未找到该文献"})
            return

        source_path = paper_path(paper)
        if not source_path.exists():
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.sse_send({"status": "error", "message": "PDF 文件不存在"})
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        try:
            is_pdf = paper["ext"] == ".pdf"
            pages = extract_pdf(source_path) if is_pdf else extract_text_file(source_path)
            pdf_meta = extract_pdf_metadata(source_path) if is_pdf else {"title": paper.get("title", ""), "authors": []}
            chunks = chunk_pages(pages)
            total = len(chunks)
            translated_chunks = []
            context_hint = ""

            for i, chunk in enumerate(chunks):
                self.sse_send({"status": "translating", "current": i + 1, "total": total})
                result = call_translate_api(chunk["text"], config, context_hint)
                translated_chunks.append(result)
                context_hint = (context_hint + "\n\n" + result)[-3000:]

            content = build_translation_markdown(paper, translated_chunks, pdf_meta)
            # QA 检查
            issues = qa_check_translation(paper, content)
            if issues:
                self.sse_send({"status": "qa_warning", "issues": issues})
            out_path = save_translation_file(paper, content)
            self.sse_send({"status": "done", "path": str(out_path.name), "qa": issues})
        except Exception as e:
            self.sse_send({"status": "error", "message": str(e)})

    def handle_upload(self):
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self.json_response({"error": "Expected multipart/form-data"}, 400)
            return

        # Check scope from query string
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        scope = qs.get("scope", [None])[0]

        raw_boundary = content_type.split("boundary=")[-1].strip().strip('"')
        boundary = raw_boundary.encode()
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        parts = body.split(b"--" + boundary)
        file_data = None
        file_name = None
        folder_path = ""
        for part in parts:
            if b"Content-Disposition" not in part:
                continue
            headers_end = part.find(b"\r\n\r\n")
            if headers_end < 0:
                continue
            part_headers = part[:headers_end].decode("utf-8", errors="ignore")
            part_data = part[headers_end + 4:]
            if part_data.endswith(b"\r\n"):
                part_data = part_data[:-2]
            if 'name="file"' in part_headers:
                fname_match = re.search(r'filename="(.+?)"', part_headers)
                file_name = fname_match.group(1) if fname_match else "upload.pdf"
                file_data = part_data
            elif 'name="folder"' in part_headers:
                folder_path = part_data.decode("utf-8", errors="ignore").strip()

        if not file_data or not file_name:
            self.json_response({"error": "No file uploaded"}, 400)
            return

        ext = Path(file_name).suffix.lower()
        if ext not in SUPPORTED_EXTS:
            self.json_response({"error": f"Unsupported file type: {ext}"}, 400)
            return

        # Determine destination directory (per-user for logged-in users)
        user_id = getattr(self, "_current_user", {})
        uid = user_id.get("id") if user_id else None

        # Public scope upload requires admin
        if scope == "public":
            if not is_admin(uid):
                self.json_response({"error": "只有管理员可以上传到公共空间"}, 403)
                return
            upload_root = ROOT_DIR
        else:
            upload_root = get_scan_root(uid)

        if folder_path:
            # Sanitize each segment of the folder path
            safe_segments = [sanitize_filename(seg) for seg in folder_path.replace("\\", "/").split("/") if seg]
            dest_dir = upload_root
            for seg in safe_segments:
                dest_dir = dest_dir / seg
            dest_dir.mkdir(parents=True, exist_ok=True)
            # Use original filename for folder uploads
            safe_name = sanitize_filename(Path(file_name).stem) + ext
        else:
            dest_dir = upload_root
            # Use original filename for single file uploads
            title = Path(file_name).stem
            safe_name = sanitize_filename(title) + ext

        dest_path = dest_dir / safe_name
        counter = 1
        while dest_path.exists():
            dest_path = dest_dir / f"{sanitize_filename(Path(safe_name).stem)} ({counter}){ext}"
            counter += 1

        dest_path.write_bytes(file_data)
        if folder_path:
            title = Path(file_name).stem
            try:
                state = read_library_state()
                rel_folder = dest_dir.relative_to(upload_root).as_posix()
                state.setdefault("folders", []).append(rel_folder)
                write_library_state(state)
            except Exception:
                pass

        invalidate_scan_cache()  # invalidate cache

        # Build paper object for immediate client display
        rel_path = dest_path.relative_to(upload_root).as_posix()
        stat = dest_path.stat()
        paper = {
            "id": safe_id(rel_path),
            "title": title,
            "fileName": dest_path.name,
            "originalFileName": file_name,
            "relPath": rel_path,
            "folder": folder_path,
            "ext": ext,
            "size": stat.st_size,
            "modifiedAt": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
            "url": f"/files/{rel_path}",
            "translation": None,
            "read": False,
            "readAt": None,
        }
        self.json_response({"ok": True, "paper": paper})

    def handle_upload_translation(self, paper_id):
        paper = get_paper(paper_id)
        if not paper:
            self.json_response({"error": "Paper not found"}, 404)
            return
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self.json_response({"error": "Expected multipart/form-data"}, 400)
            return
        raw_boundary = content_type.split("boundary=")[-1].strip().strip('"')
        boundary = raw_boundary.encode()
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        file_data = None
        file_name = None
        for part in body.split(b"--" + boundary):
            if b"Content-Disposition" not in part:
                continue
            headers_end = part.find(b"\r\n\r\n")
            if headers_end < 0:
                continue
            part_headers = part[:headers_end].decode("utf-8", errors="ignore")
            part_data = part[headers_end + 4:]
            if part_data.endswith(b"\r\n"):
                part_data = part_data[:-2]
            if 'name="file"' in part_headers:
                fname_match = re.search(r'filename="(.+?)"', part_headers)
                file_name = fname_match.group(1) if fname_match else "translation.md"
                file_data = part_data
        if not file_data or not file_name:
            self.json_response({"error": "No translation uploaded"}, 400)
            return
        ext = Path(file_name).suffix.lower()
        if ext not in {".md", ".txt", ".html", ".htm", ".pdf"}:
            self.json_response({"error": f"Unsupported translation type: {ext}"}, 400)
            return
        # Save to user's translations dir (per-user) or shared manual dir (anonymous)
        user_id = getattr(self, "_current_user", {})
        uid = user_id.get("id") if user_id else None
        if uid:
            dest_dir = get_user_data_dir(uid) / "translations"
        else:
            dest_dir = TRANSLATED_DOCS_DIR / "manual"
        dest_dir.mkdir(parents=True, exist_ok=True)
        safe_name = f"{paper_id}_{sanitize_filename(Path(file_name).stem)}{ext}"
        dest_path = dest_dir / safe_name
        dest_path.write_bytes(file_data)
        # Store rel_path relative to scan_root so scan_papers can resolve it
        scan_root = get_scan_root(uid)
        rel_path = dest_path.relative_to(scan_root).as_posix()
        state = read_library_state()
        state.setdefault("translations", {})[paper["relPath"]] = rel_path
        write_library_state(state)
        invalidate_scan_cache()
        self.json_response({"ok": True, "translation": file_payload(dest_path), "papers": scan_papers()})

    def handle_ask_sse(self, paper_id, from_post=False):
        parsed = urlparse(self.path)

        def send_sse_error(msg):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.sse_send({"status": "error", "message": msg})

        # Read config and question from POST body or GET query
        image = None
        if from_post:
            body = self.read_body()
            question = body.get("question", "")
            image = body.get("image")
            config = {
                "api_key": body.get("api_key", "") or TRANSLATE_API_KEY,
                "base_url": body.get("base_url", "") or TRANSLATE_BASE_URL,
                "model": body.get("model", "") or TRANSLATE_MODEL,
            }
            ask_mode = body.get("ask_mode", "balanced")
            if not config["api_key"]:
                config = None
        else:
            config = get_translate_config(parsed.query)
            ask_mode = "balanced"
            question = ""
            for param in parsed.query.split("&"):
                if param.startswith("q="):
                    question = unquote(param[2:])

        if not config:
            send_sse_error("AI 服务未配置。请在设置中填写 API Key。")
            return

        paper = get_paper(paper_id)
        if not paper:
            send_sse_error("未找到该文献")
            return

        if not question and not image:
            send_sse_error("缺少问题参数")
            return

        source_path = paper_path(paper)
        if not source_path.exists():
            send_sse_error("文件不存在")
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        try:
            import sys
            print(f"[ask] model={config['model']!r}, has_image={image is not None}", file=sys.stderr)

            paper_text = build_ask_context(paper, source_path, question, ask_mode)
            max_output_tokens = {
                "turbo": 768,
                "quick": 1024,
                "balanced": 1536,
                "full": 4096,
            }.get(ask_mode, 1536)

            system_prompt = (
                "你是一位学术论文阅读助手。用户正在阅读一篇论文，以下是论文的相关内容片段。"
                "请根据论文内容回答用户的问题。回答要求：\n"
                "1. 基于论文内容准确回答，不要编造信息\n"
                "2. 如果当前片段没有覆盖相关信息，请明确说明上下文不足\n"
                "3. 可以引用论文中的具体段落或数据\n"
                "4. 使用中文回答\n"
                "5. 适当使用 Markdown 格式让回答更清晰\n\n"
                f"=== 论文标题：{paper['title']} ===\n"
                f"=== 上下文模式：{ask_mode} ===\n\n{paper_text}"
            )
            base_url = normalize_base_url(config["base_url"])

            # Build user content with optional image
            if is_anthropic_api(base_url):
                # Anthropic format
                content = [{"type": "text", "text": question or "请描述这张图片"}]
                if image:
                    b64_data = image["dataUrl"].split(",", 1)[1] if "," in image["dataUrl"] else image["dataUrl"]
                    content.append({
                        "type": "image",
                        "source": {"type": "base64", "media_type": image["mediaType"], "data": b64_data},
                    })
                if Anthropic is None:
                    raise RuntimeError("未安装 anthropic 库，请运行 pip install anthropic")
                client = Anthropic(api_key=config["api_key"], base_url=base_url)
                with client.messages.stream(
                    model=config["model"],
                    max_tokens=max_output_tokens,
                    system=system_prompt,
                    messages=[{"role": "user", "content": content}],
                    temperature=0.3,
                ) as stream:
                    for text in stream.text_stream:
                        self.sse_send({"status": "token", "text": text})
                self.sse_send({"status": "done"})
            else:
                # OpenAI format
                content = [{"type": "text", "text": question or "请描述这张图片"}]
                if image:
                    content.append({"type": "image_url", "image_url": {"url": image["dataUrl"]}})
                if OpenAI is None:
                    raise RuntimeError("未安装 openai 库，请运行 pip install openai")
                client = OpenAI(api_key=config["api_key"], base_url=base_url)
                response = client.chat.completions.create(
                    model=config["model"],
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": content},
                    ],
                    temperature=0.3,
                    max_tokens=max_output_tokens,
                    stream=True,
                )
                for chunk in response:
                    if chunk.choices and chunk.choices[0].delta.content:
                        self.sse_send({"status": "token", "text": chunk.choices[0].delta.content})
                self.sse_send({"status": "done"})
        except Exception as e:
            import sys, traceback
            print(f"[ask] ERROR: {type(e).__name__}: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            self.sse_send({"status": "error", "message": str(e)})

    def handle_related_sse(self, paper_id):
        import urllib.request
        import urllib.parse

        parsed = urlparse(self.path)

        def send_sse_error(msg):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.sse_send({"status": "error", "message": msg})

        config = get_translate_config(parsed.query)
        if not config:
            send_sse_error("AI 服务未配置。请在设置中填写 API Key。")
            return

        paper = get_paper(paper_id)
        if not paper:
            send_sse_error("未找到该文献")
            return

        source_path = paper_path(paper)
        if not source_path.exists():
            send_sse_error("文件不存在")
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        try:
            # Extract text from first 5 pages for keyword generation
            if paper["ext"] == ".pdf" and fitz is not None:
                pages = []
                with fitz.open(source_path) as doc:
                    for index, page in enumerate(doc, start=1):
                        if index > 5:
                            break
                        text = page.get_text("text")
                        pages.append(text)
                paper_text = "\n".join(pages)
            elif paper["ext"] in (".md", ".txt"):
                paper_text = source_path.read_text(encoding="utf-8", errors="ignore")[:10000]
            else:
                paper_text = ""

            max_chars = 15000
            if len(paper_text) > max_chars:
                paper_text = paper_text[:max_chars]

            # Step 1: Ask AI to generate search keywords
            self.sse_send({"status": "keywords", "text": "正在分析论文并生成搜索关键词..."})

            system_prompt = (
                "你是一位学术文献搜索助手。请根据以下论文内容，生成 3-5 个适合在学术搜索引擎中查找相关文献的英文搜索查询词。"
                "要求：\n"
                "1. 每个查询词应该简洁（2-6个英文单词）\n"
                "2. 涵盖论文的核心主题、方法和应用领域\n"
                "3. 只输出查询词，每行一个，不要编号或其他文字\n"
                "4. 使用英文\n\n"
                f"论文标题：{paper['title']}\n\n论文内容片段：\n{paper_text}"
            )

            base_url = normalize_base_url(config["base_url"])
            keywords_text = ""

            if is_anthropic_api(base_url):
                if Anthropic is None:
                    raise RuntimeError("未安装 anthropic 库")
                client = Anthropic(api_key=config["api_key"], base_url=base_url)
                with client.messages.stream(
                    model=config["model"],
                    max_tokens=256,
                    system=system_prompt,
                    messages=[{"role": "user", "content": "请生成搜索关键词"}],
                    temperature=0.3,
                ) as stream:
                    for text in stream.text_stream:
                        keywords_text += text
                        self.sse_send({"status": "keywords", "text": keywords_text})
            else:
                if OpenAI is None:
                    raise RuntimeError("未安装 openai 库")
                client = OpenAI(api_key=config["api_key"], base_url=base_url)
                response = client.chat.completions.create(
                    model=config["model"],
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": "请生成搜索关键词"},
                    ],
                    temperature=0.3,
                    max_tokens=256,
                    stream=True,
                )
                for chunk in response:
                    if chunk.choices and chunk.choices[0].delta.content:
                        keywords_text += chunk.choices[0].delta.content
                        self.sse_send({"status": "keywords", "text": keywords_text})

            # Parse keywords
            keywords = [line.strip() for line in keywords_text.strip().splitlines() if line.strip()]
            if not keywords:
                keywords = [paper["title"]]

            query = " ".join(keywords[:5])
            self.sse_send({"status": "searching", "query": query})

            # Step 2: Search Semantic Scholar API (with retry)
            search_url = (
                "https://api.semanticscholar.org/graph/v1/paper/search?"
                + urllib.parse.urlencode({
                    "query": query,
                    "limit": 10,
                    "fields": "title,authors,abstract,citationCount,year,url,externalIds",
                })
            )
            data = None
            for attempt in range(3):
                try:
                    req = urllib.request.Request(search_url, headers={"User-Agent": "LiteratureReader/1.0"})
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                    break
                except Exception as e:
                    if attempt < 2:
                        self.sse_send({"status": "searching", "query": f"{query} (重试 {attempt + 2}/3...)"})
                    else:
                        raise

            papers = []
            for item in data.get("data", []):
                authors = [a.get("name", "") for a in (item.get("authors") or [])]
                paper_url = item.get("url", "")
                if not paper_url and item.get("externalIds", {}).get("DOI"):
                    paper_url = f"https://doi.org/{item['externalIds']['DOI']}"
                papers.append({
                    "title": item.get("title", ""),
                    "authors": authors,
                    "year": item.get("year"),
                    "citations": item.get("citationCount", 0),
                    "abstract": (item.get("abstract") or "")[:300],
                    "url": paper_url,
                })

            self.sse_send({"status": "results", "papers": papers})
            self.sse_send({"status": "done"})

        except Exception as e:
            msg = str(e)
            if "Remote end closed connection" in msg:
                msg = "外部相关文献搜索服务断开连接，可能是网络波动或接口限流。请稍后重试。"
            elif "timed out" in msg.lower() or "timeout" in msg.lower():
                msg = "外部相关文献搜索服务响应超时。请稍后重试。"
            self.sse_send({"status": "error", "message": msg})

    def do_POST(self):  # noqa: N802
        # 用户认证端点不需要 Basic Auth
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            # 用户注册
            if path == "/api/auth/register":
                payload = self.read_body()
                email = payload.get("email", "").strip().lower()
                password = payload.get("password", "")
                if not email or not password:
                    self.json_response({"error": "邮箱和密码不能为空"}, 400)
                    return
                if "@" not in email:
                    self.json_response({"error": "邮箱格式不正确"}, 400)
                    return
                if len(password) < 6:
                    self.json_response({"error": "密码至少需要6位"}, 400)
                    return
                try:
                    user = create_user(email, password)
                    token = generate_token(user["id"], email)
                    admin = is_admin(user["id"])
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Set-Cookie", f"session_token={token}; Path=/; Max-Age=604800; HttpOnly")
                    body = json.dumps({"ok": True, "user": {"id": user["id"], "email": email, "isAdmin": admin}}).encode("utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except ValueError as e:
                    self.json_response({"error": str(e)}, 400)
                except Exception as e:
                    self.json_response({"error": "注册失败: " + str(e)}, 500)
                return

            # 用户登录
            if path == "/api/auth/login":
                payload = self.read_body()
                email = payload.get("email", "").strip().lower()
                password = payload.get("password", "")
                if not email or not password:
                    self.json_response({"error": "邮箱和密码不能为空"}, 400)
                    return
                user = get_user_by_email(email)
                if not user or not verify_password(password, user["password"]):
                    self.json_response({"error": "邮箱或密码错误"}, 401)
                    return
                token = generate_token(user["id"], email)
                admin = is_admin(user["id"])
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Set-Cookie", f"session_token={token}; Path=/; Max-Age=604800; HttpOnly")
                body = json.dumps({"ok": True, "user": {"id": user["id"], "email": email, "isAdmin": admin}}).encode("utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            # 用户登出
            if path == "/api/auth/logout":
                cookies = self.headers.get("Cookie", "")
                for cookie in cookies.split(";"):
                    cookie = cookie.strip()
                    if cookie.startswith("session_token="):
                        token = cookie.split("=", 1)[1]
                        _current_sessions.pop(token, None)
                        _save_sessions()
                        break
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Set-Cookie", "session_token=; Path=/; Max-Age=0")
                body = json.dumps({"ok": True}).encode("utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            # 以下端点需要认证
            if not self.require_auth():
                return

            # 设置请求上下文（用户数据隔离）
            user = getattr(self, "_current_user", None)
            _request_context.user_id = user["id"] if user else None

            if path == "/api/scan":
                invalidate_scan_cache()  # force rescan
                qs = parse_qs(parsed.query)
                scope = qs.get("scope", [None])[0]
                self.json_response({"papers": scan_papers(scope=scope), "scannedAt": datetime.now().isoformat(timespec="seconds")})
                return
            if path == "/api/upload":
                self.handle_upload()
                return
            if path.startswith("/api/upload-translation/"):
                paper_id = path.rsplit("/", 1)[-1]
                self.handle_upload_translation(paper_id)
                return
            if path == "/api/folders":
                payload = self.read_body()
                # Public scope folder creation requires admin
                folder_scope = payload.get("scope")
                if folder_scope == "public" and not is_admin(user["id"]):
                    self.json_response({"error": "只有管理员可以在公共空间创建文件夹"}, 403)
                    return
                try:
                    folder_path, rel_folder = safe_folder_path(payload.get("name", ""))
                    folder_path.mkdir(parents=True, exist_ok=True)
                    state = read_library_state()
                    state.setdefault("folders", []).append(rel_folder)
                    write_library_state(state)
                    invalidate_scan_cache()
                    self.json_response({"ok": True, "folder": rel_folder, "folders": list_library_folders()})
                except Exception as e:
                    self.json_response({"error": str(e)}, 400)
                return
            if path == "/api/storage-path":
                payload = self.read_body()
                new_path = (payload.get("path") or "").strip()
                if new_path:
                    p = Path(new_path).resolve()
                    if not p.is_dir():
                        self.json_response({"error": "路径不存在或不是文件夹"}, 400)
                        return
                users = get_users()
                if user and user["id"] in users:
                    users[user["id"]]["storagePath"] = new_path
                    save_users(users)
                invalidate_scan_cache()
                self.json_response({"ok": True, "path": new_path})
                return
            if path == "/api/user-config":
                payload = self.read_body()
                api_cfg = {
                    "apiKey": (payload.get("apiKey") or "").strip(),
                    "baseUrl": (payload.get("baseUrl") or "").strip(),
                    "model": (payload.get("model") or "").strip(),
                    "askMode": (payload.get("askMode") or "balanced").strip(),
                }
                users = get_users()
                if user and user["id"] in users:
                    users[user["id"]]["apiConfig"] = api_cfg
                    save_users(users)
                self.json_response({"ok": True})
                return
            if path.startswith("/api/ask/"):
                paper_id = path.split("/")[3]
                self.handle_ask_sse(paper_id, from_post=True)
                return
            if path.startswith("/api/annotations/"):
                paper_id = path.rsplit("/", 1)[-1]
                payload = self.read_body()
                payload["updatedAt"] = datetime.now().isoformat(timespec="seconds")
                write_annotations(paper_id, payload)
                self.json_response({"ok": True})
                return
            if path == "/api/comments":
                payload = self.read_body()
                text = (payload.get("text") or "").strip()
                if not text:
                    self.json_response({"error": "评论内容不能为空"}, 400)
                    return
                reply_to = (payload.get("replyTo") or "").strip() or None
                data = write_comment(text, user["id"] if user else "", user["email"] if user else "", reply_to)
                self.json_response({"ok": True, "comments": data.get("comments", [])})
                return
            if path.startswith("/api/translations/"):
                paper_id = path.rsplit("/", 1)[-1]
                payload = self.read_body()
                payload["updatedAt"] = datetime.now().isoformat(timespec="seconds")
                # Translations are stored globally (not per-user) since they're shared
                write_json(TRANSLATIONS_DIR / f"{paper_id}.json", payload)
                self.json_response({"ok": True})
                return
            if path.startswith("/api/rename/"):
                paper_id = path.rsplit("/", 1)[-1]
                paper = get_paper(paper_id)
                if not paper:
                    self.json_response({"error": "未找到该文献"}, 404)
                    return
                payload = self.read_body()
                name = sanitize_filename(payload.get("name", ""))
                if not name:
                    self.json_response({"error": "名称不能为空"}, 400)
                    return
                qs = parse_qs(parsed.query)
                scope = qs.get("scope", [None])[0]
                if scope == "public":
                    state = read_json(LIBRARY_STATE_PATH, {})
                    state.setdefault("folders", [])
                    state.setdefault("hidden", [])
                    state.setdefault("names", {})
                    state.setdefault("translations", {})
                else:
                    state = read_library_state()
                state.setdefault("names", {})[paper["relPath"]] = name
                if scope == "public":
                    state["folders"] = sorted(set(state.get("folders", [])), key=lambda name: name.lower())
                    state["hidden"] = sorted(set(state.get("hidden", [])))
                    write_json(LIBRARY_STATE_PATH, state)
                else:
                    write_library_state(state)
                invalidate_scan_cache()
                self.json_response({"ok": True, "papers": scan_papers(scope=scope)})
                return
            if path.startswith("/api/rename-folder/"):
                old_name = unquote(path.removeprefix("/api/rename-folder/"))
                payload = self.read_body()
                new_name = sanitize_filename(payload.get("name", ""))
                if not new_name:
                    self.json_response({"error": "名称不能为空"}, 400)
                    return
                qs = parse_qs(parsed.query)
                scope = qs.get("scope", [None])[0]
                try:
                    _, rel_old = safe_folder_path(old_name)
                    _, rel_new = safe_folder_path(new_name)
                except Exception as e:
                    self.json_response({"error": str(e)}, 400)
                    return
                if scope == "public":
                    state = read_json(LIBRARY_STATE_PATH, {})
                else:
                    state = read_library_state()
                folders = state.get("folders", [])
                if rel_old not in folders:
                    self.json_response({"error": "文件夹不存在"}, 404)
                    return
                # Rename physical directory
                scan_root = ROOT_DIR if scope == "public" else get_scan_root(user["id"] if user else None)
                old_dir = scan_root / rel_old
                new_dir = scan_root / rel_new
                if old_dir.is_dir() and not new_dir.exists():
                    old_dir.rename(new_dir)
                # Update folder list
                folders = [new_name if f == rel_old else f for f in folders]
                state["folders"] = folders
                # Update paper relPaths that reference old folder
                hidden = state.get("hidden", [])
                names = state.get("names", {})
                translations = state.get("translations", {})
                prefix_old = rel_old + "/"
                prefix_new = rel_new + "/"
                for key in ["hidden", "names", "translations"]:
                    src = state.get(key, {})
                    if isinstance(src, list):
                        state[key] = [new_name + v[len(rel_old):] if v.startswith(prefix_old) else v for v in src]
                    elif isinstance(src, dict):
                        state[key] = {(new_name + k[len(rel_old):]) if k.startswith(prefix_old) else k: v for k, v in src.items()}
                if scope == "public":
                    write_json(LIBRARY_STATE_PATH, state)
                else:
                    write_library_state(state)
                invalidate_scan_cache()
                self.json_response({"ok": True, "papers": scan_papers(scope=scope), "folders": list_library_folders()})
                return
            if path.startswith("/api/extract-title/"):
                paper_id = path.rsplit("/", 1)[-1]
                qs = parse_qs(parsed.query)
                scope = qs.get("scope", [None])[0]
                all_papers = scan_papers(scope=scope)
                paper = next((p for p in all_papers if p["id"] == paper_id), None)
                if not paper:
                    self.json_response({"error": "未找到该文献"}, 404)
                    return
                if paper["ext"] != ".pdf":
                    self.json_response({"error": "只有 PDF 文件支持提取标题"}, 400)
                    return
                try:
                    pdf_path = paper_path(paper)
                    config = get_translate_config(parsed.query)
                    title = ""
                    if config:
                        title = ai_extract_pdf_title(pdf_path, config)
                    if not title:
                        title = extract_pdf_title(pdf_path)
                    if not title:
                        self.json_response({"error": "无法从 PDF 中提取标题"}, 400)
                        return
                    if scope == "public":
                        state = read_json(LIBRARY_STATE_PATH, {})
                        state.setdefault("folders", [])
                        state.setdefault("hidden", [])
                        state.setdefault("names", {})
                        state.setdefault("translations", {})
                    else:
                        state = read_library_state()
                    state.setdefault("names", {})[paper["relPath"]] = title
                    if scope == "public":
                        state["folders"] = sorted(set(state.get("folders", [])), key=lambda name: name.lower())
                        state["hidden"] = sorted(set(state.get("hidden", [])))
                        write_json(LIBRARY_STATE_PATH, state)
                    else:
                        write_library_state(state)
                    invalidate_scan_cache()
                    self.json_response({"ok": True, "title": title, "papers": scan_papers(scope=scope)})
                except Exception as e:
                    self.json_response({"error": str(e)}, 500)
                return
            # Save public paper to user's personal library
            if path.endswith("/save-to-library"):
                parts = path.split("/")
                paper_id = parts[3]  # /api/papers/{id}/save-to-library
                uid = user["id"]
                # Find the paper in public space (ROOT_DIR)
                public_papers = scan_papers(scope="public")
                paper = next((p for p in public_papers if p["id"] == paper_id), None)
                if not paper:
                    self.json_response({"error": "文献未找到"}, 404)
                    return
                # Copy the file to user's papers directory
                src_path = ROOT_DIR / paper["relPath"]
                if not src_path.exists():
                    self.json_response({"error": "文件不存在"}, 404)
                    return
                user_papers_dir = get_user_data_dir(uid) / "papers"
                user_papers_dir.mkdir(parents=True, exist_ok=True)
                dest_path = user_papers_dir / src_path.name
                # Deduplicate
                counter = 1
                while dest_path.exists():
                    dest_path = user_papers_dir / f"{src_path.stem} ({counter}){src_path.suffix}"
                    counter += 1
                import shutil
                shutil.copy2(src_path, dest_path)
                # Also copy translation if exists
                if paper.get("translation") and paper["translation"].get("relPath"):
                    trans_src = ROOT_DIR / paper["translation"]["relPath"]
                    if trans_src.exists():
                        user_trans_dir = get_user_data_dir(uid) / "translations"
                        user_trans_dir.mkdir(parents=True, exist_ok=True)
                        trans_dest = user_trans_dir / trans_src.name
                        shutil.copy2(trans_src, trans_dest)
                invalidate_scan_cache()
                self.json_response({"ok": True, "papers": scan_papers()})
                return
            if path == "/api/papers/batch-delete":
                # Public scope batch-delete requires admin
                qs = parse_qs(parsed.query)
                scope = qs.get("scope", [None])[0]
                if scope == "public" and not is_admin(user["id"]):
                    self.json_response({"error": "只有管理员可以删除公共文献"}, 403)
                    return
                payload = self.read_body()
                ids = payload.get("ids", [])
                folders_to_delete = payload.get("folders", [])
                if not ids and not folders_to_delete:
                    self.json_response({"error": "No paper IDs or folders provided"}, 400)
                    return
                try:
                    state = read_library_state()
                    hidden = state.setdefault("hidden", [])
                    names = state.get("names", {})
                    translations = state.get("translations", {})
                    all_papers = scan_papers()
                    id_set = set(ids)
                    affected_folders = set()
                    for paper in all_papers:
                        if paper["id"] in id_set:
                            rel = paper["relPath"]
                            if rel not in hidden:
                                hidden.append(rel)
                            names.pop(rel, None)
                            translations.pop(rel, None)
                            folder = paper.get("folder", "")
                            if folder:
                                affected_folders.add(folder)
                    # Add explicitly selected folders
                    affected_folders.update(folders_to_delete)
                    # Remove empty folders
                    remaining_papers = [p for p in all_papers if p["id"] not in id_set]
                    folders = state.get("folders", [])
                    for folder in affected_folders:
                        has_papers = any(p.get("folder") == folder for p in remaining_papers)
                        if not has_papers and folder in folders:
                            folders.remove(folder)
                    state["folders"] = folders
                    write_library_state(state)
                    invalidate_scan_cache()
                except Exception as e:
                    self.json_response({"error": str(e)}, 500)
                    return
                self.json_response({"ok": True, "deleted": len(ids), "papers": remaining_papers, "folders": list_library_folders()})
                return
            if path.startswith("/api/read-status/"):
                paper_id = path.rsplit("/", 1)[-1]
                payload = self.read_body()
                statuses = read_read_status()
                if payload.get("read"):
                    statuses[paper_id] = {
                        "read": True,
                        "updatedAt": datetime.now().isoformat(timespec="seconds"),
                    }
                else:
                    statuses.pop(paper_id, None)
                write_read_status(statuses)
                self.json_response({"ok": True, "read": bool(payload.get("read"))})
                return
            self.json_response({"error": "Unknown endpoint"}, 404)
        except Exception as e:
            print(f"[ERROR] do_POST {path}: {e}")
            import traceback
            traceback.print_exc()
            try:
                self.json_response({"error": str(e)}, 500)
            except Exception:
                pass

    def do_DELETE(self):  # noqa: N802
        if not self.require_auth():
            return

        # 设置请求上下文（用户数据隔离）
        user = getattr(self, "_current_user", None)
        _request_context.user_id = user["id"] if user else None

        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        scope = qs.get("scope", [None])[0]
        path = parsed.path

        try:
            if path.startswith("/api/papers/"):
                # Public scope delete requires admin
                if scope == "public" and not is_admin(user["id"]):
                    self.json_response({"error": "只有管理员可以删除公共文献"}, 403)
                    return
                paper_id = path.rsplit("/", 1)[-1]
                all_papers = scan_papers()
                paper = next((p for p in all_papers if p["id"] == paper_id), None)
                if not paper:
                    self.json_response({"error": "Paper not found"}, 404)
                    return
                try:
                    state = read_library_state()
                    state.setdefault("hidden", []).append(paper["relPath"])
                    state.get("names", {}).pop(paper["relPath"], None)
                    state.get("translations", {}).pop(paper["relPath"], None)
                    # Check if folder becomes empty
                    folder = paper.get("folder", "")
                    remaining = [p for p in all_papers if p["id"] != paper_id]
                    if folder and not any(p.get("folder") == folder for p in remaining):
                        folders = state.get("folders", [])
                        if folder in folders:
                            folders.remove(folder)
                            state["folders"] = folders
                    write_library_state(state)
                    invalidate_scan_cache()
                except Exception as e:
                    self.json_response({"error": str(e)}, 500)
                    return
                self.json_response({"ok": True, "papers": remaining, "folders": list_library_folders()})
                return
            if path.startswith("/api/folders/"):
                # Public scope folder delete requires admin
                if scope == "public" and not is_admin(user["id"]):
                    self.json_response({"error": "只有管理员可以删除公共文件夹"}, 403)
                    return
                folder = unquote(path.removeprefix("/api/folders/"))
                try:
                    _, rel_folder = safe_folder_path(folder)
                    state = read_library_state()
                    state["folders"] = [name for name in state.get("folders", []) if name != rel_folder]
                    all_papers = scan_papers()
                    hidden = state.setdefault("hidden", [])
                    for paper in all_papers:
                        if paper.get("folder") == rel_folder:
                            if paper["relPath"] not in hidden:
                                hidden.append(paper["relPath"])
                    remaining = [p for p in all_papers if p.get("folder") != rel_folder]
                    write_library_state(state)
                    invalidate_scan_cache()
                    self.json_response({"ok": True, "folder": rel_folder, "papers": remaining, "folders": list_library_folders()})
                except Exception as e:
                    self.json_response({"error": str(e)}, 400)
                return
            if path.startswith("/api/comments/"):
                comment_id = path.rsplit("/", 1)[-1]
                try:
                    data = delete_comment(comment_id, user["id"] if user else "", is_admin(user["id"] if user else None))
                    self.json_response({"ok": True, "comments": data.get("comments", [])})
                except ValueError as e:
                    self.json_response({"error": str(e)}, 403)
                return
            self.json_response({"error": "Unknown endpoint"}, 404)
        except Exception as e:
            print(f"[ERROR] do_DELETE {path}: {e}")
            import traceback
            traceback.print_exc()
            try:
                self.json_response({"error": str(e)}, 500)
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--scan-only", action="store_true")
    args = parser.parse_args()

    ensure_dirs()
    cleanup_old_png_cache()
    cleanup_expired_sessions()
    ensure_admin()
    migrate_user_dirs()
    if args.scan_only:
        papers = scan_papers()
        print(f"Scanned {len(papers)} literature file(s).")
        return

    start_reload_watcher()
    httpd = ThreadingHTTPServer((args.host, args.port), LiteratureHandler)
    print(f"Literature reader: http://{args.host}:{args.port}")
    print(f"Watching folder: {ROOT_DIR}")
    print(f"Data directory: {DATA_DIR}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
