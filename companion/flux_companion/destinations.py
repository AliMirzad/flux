"""Local folder approvals. Native messages can list handles, never approve paths."""

import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path

from .platforms import PlatformAdapter


class DestinationError(ValueError):
    pass


class DestinationUnavailable(DestinationError):
    pass


class DestinationStoreError(DestinationError):
    pass


def destination_id(value):
    try:
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError()
    except (ValueError, AttributeError) as exc:
        raise DestinationError("Expected a destination ID.") from exc
    return value


class DestinationRegistry:
    def __init__(self, directory: Path, platform: PlatformAdapter):
        self.directory = directory
        self.database = directory / "destinations.sqlite3"
        self.platform = platform

    @contextmanager
    def _connection(self, create=False):
        connection = None
        try:
            if self.platform.prepare_private_database(self.directory, self.database.name, create) is None:
                yield None
                return
            connection = sqlite3.connect(self.database.as_uri() + "?mode=rw", uri=True, timeout=2)
            connection.execute("BEGIN IMMEDIATE" if create else "BEGIN")
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version == 0 and create:
                connection.execute("""CREATE TABLE destinations (
                    id TEXT PRIMARY KEY, label TEXT NOT NULL, path TEXT NOT NULL,
                    device TEXT NOT NULL, inode TEXT NOT NULL, birth TEXT NOT NULL,
                    UNIQUE(path, device, inode, birth))""")
                connection.execute("PRAGMA user_version = 1")
            elif version != 1:
                raise DestinationStoreError("Unsupported companion destination data version.")
            yield connection
            connection.commit()
        except (OSError, sqlite3.Error, ValueError) as exc:
            if isinstance(exc, DestinationError):
                raise
            raise DestinationStoreError("Could not access companion destination data.") from exc
        finally:
            if connection is not None:
                connection.close()

    def approve(self, path: Path, label: str):
        if (not isinstance(label, str) or not 1 <= len(label) <= 128
                or label != label.strip() or any(ord(char) < 32 or ord(char) == 127 for char in label)):
            raise DestinationError("Use a label of 1–128 characters without control characters.")
        try:
            resolved, device, inode, birth = self.platform.folder_identity(path)
        except (OSError, RuntimeError, ValueError) as exc:
            raise DestinationUnavailable("Choose an existing directory.") from exc
        with self._connection(create=True) as connection:
            existing = connection.execute(
                "SELECT id FROM destinations WHERE path=? AND device=? AND inode=? AND birth=?",
                (str(resolved), device, inode, birth)).fetchone()
            if existing:
                key = existing[0]
                connection.execute("UPDATE destinations SET label=? WHERE id=?", (label, key))
            else:
                if connection.execute("SELECT COUNT(*) FROM destinations").fetchone()[0] >= 50:
                    raise DestinationError("Revoke an existing destination before approving more than 50 folders.")
                key = str(uuid.uuid4())
                connection.execute("INSERT INTO destinations VALUES (?,?,?,?,?,?)",
                                   (key, label, str(resolved), device, inode, birth))
        return {"id": key, "label": label}

    def _rows(self):
        with self._connection() as connection:
            if connection is None:
                return []
            rows = connection.execute(
                "SELECT id,label,path,device,inode,birth FROM destinations ORDER BY rowid LIMIT 51").fetchall()
            if len(rows) > 50:
                raise DestinationStoreError("Too many saved companion destinations.")
            for key, label, path, device, inode, birth in rows:
                destination_id(key)
                if (not isinstance(label, str) or not 1 <= len(label) <= 128
                        or any(ord(char) < 32 or ord(char) == 127 for char in label)
                        or not isinstance(path, str) or not Path(path).is_absolute()
                        or not isinstance(device, str) or not device.isdecimal()
                        or not isinstance(inode, str) or not inode.isdecimal()
                        or not isinstance(birth, str) or not 1 <= len(birth) <= 64):
                    raise DestinationStoreError("Invalid saved companion destination.")
            return rows

    def _available(self, row):
        try:
            resolved, device, inode, birth = self.platform.folder_identity(Path(row[2]))
            return str(resolved) == row[2] and (device, inode, birth) == (row[3], row[4], row[5])
        except (OSError, ValueError, RuntimeError):
            return False

    def list(self):
        return [{"id": row[0], "label": row[1]} for row in self._rows() if self._available(row)]

    def resolve(self, key):
        destination_id(key)
        for row in self._rows():
            if row[0] == key and self._available(row):
                return Path(row[2])
        raise DestinationUnavailable("Destination is no longer available. Approve the folder again locally.")

    def revoke(self, key):
        destination_id(key)
        with self._connection(create=True) as connection:
            connection.execute("DELETE FROM destinations WHERE id=?", (key,))
