"""Direct HTTP(S) policy for the trusted CPython inspection worker."""

import ipaddress
import io
import os
import socket

from .media import validate_source


class NetworkDenied(OSError):
    pass


class DestinationDenied(NetworkDenied):
    pass


class ResponseBudget:
    def __init__(self):
        self.remaining = 32 * 1024 * 1024


class LimitedReader(io.IOBase):
    def __init__(self, response, budget):
        self.response = response
        self.budget = budget
        self.remaining = 8 * 1024 * 1024

    def read(self, size=-1):
        limit = min(self.remaining, self.budget.remaining)
        data = self.response.read(limit + 1 if size is None or size < 0 else min(size, limit + 1))
        if len(data) > limit:
            self.close()
            raise NetworkDenied("Inspection response limit reached")
        self.remaining -= len(data)
        self.budget.remaining -= len(data)
        return data

    def readable(self):
        return True

    def close(self):
        self.response.close()
        super().close()


class DirectNetworkPolicy:
    def __init__(self):
        self.connections = 0

    def audit(self, event, args):
        if event == "urllib.Request":
            try:
                validate_source(args[0])
            except ValueError as exc:
                raise NetworkDenied("Destination is not permitted") from exc
        elif event == "socket.connect":
            sock, address = args
            if sock.family not in {socket.AF_INET, socket.AF_INET6} or not isinstance(address, tuple):
                raise NetworkDenied("Only public TCP connections are permitted")
            try:
                # Check the actual numeric connect destination, not a separate
                # DNS lookup that could change before the socket connects.
                ip = ipaddress.ip_address(address[0])
            except ValueError as exc:
                raise NetworkDenied("Connections must use resolved addresses") from exc
            transition = isinstance(ip, ipaddress.IPv6Address) and (
                ip.ipv4_mapped is not None or ip.sixtofour is not None or ip.teredo is not None
                or ip in ipaddress.ip_network("64:ff9b::/96")
                or ip in ipaddress.ip_network("64:ff9b:1::/48"))
            if not ip.is_global or transition:
                raise DestinationDenied("Private destinations are not permitted")
            self.connections += 1
            if self.connections > 100:
                raise NetworkDenied("Inspection connection limit reached")
        elif event in {"socket.bind", "socket.sendto", "subprocess.Popen", "os.system",
                       "os.posix_spawn", "os.fork", "os.forkpty", "os.exec", "ctypes.dlopen",
                       "os.mkdir", "os.rename", "os.remove", "os.rmdir", "os.link", "os.symlink", "os.truncate"}:
            raise NetworkDenied("External execution and alternate networking are disabled")
        elif event == "open":
            _, mode, flags = args
            if (isinstance(mode, str) and any(char in mode for char in "wax+")) or (
                    isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC)):
                raise NetworkDenied("Inspection cannot write files")
