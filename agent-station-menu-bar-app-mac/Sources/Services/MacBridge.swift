import Foundation
import Network

/// Tier 2 action bridge: a loopback HTTP server the agent's shell tool can
/// `curl` to perceive and drive the Mac. Routes:
///   GET  /context      -> { frontmostApp, bundleId, windowTitle, environmentId, ... }
///   POST /applescript  -> { script }            -> { ok, output }
///   POST /open-url     -> { url }               -> { ok }
///   GET  /health       -> { ok, service }
///
/// Bound to 127.0.0.1 only. Action handlers (AppleScript, open-url) are
/// injected by the model so AppKit work happens on the main thread; the
/// /context payload is a pre-encoded snapshot updated from the model.
final class MacBridge {
    // Injected by the model; run on the bridge queue, hop to main themselves.
    var runAppleScript: ((String) -> (ok: Bool, output: String))?
    var openURL: ((String) -> Bool)?

    private let queue = DispatchQueue(label: "com.rookery.mac-bridge")
    private var listener: NWListener?
    private let lock = NSLock()
    private var contextJSON = Data("{}".utf8)
    private(set) var port: UInt16 = 0

    func start(port: UInt16) {
        guard listener == nil else {
            return
        }
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: "127.0.0.1",
            port: NWEndpoint.Port(rawValue: port)!
        )
        do {
            let listener = try NWListener(using: params)
            listener.newConnectionHandler = { [weak self] connection in
                self?.handle(connection)
            }
            listener.stateUpdateHandler = { [weak self] state in
                if case .ready = state {
                    self?.port = port
                    providerLog("bridge listening on 127.0.0.1:\(port)")
                } else if case .failed(let error) = state {
                    providerLog("bridge failed: \(error.localizedDescription)")
                }
            }
            listener.start(queue: queue)
            self.listener = listener
        } catch {
            providerLog("bridge could not start on \(port): \(error.localizedDescription)")
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    func updateContext(_ data: Data) {
        lock.lock()
        contextJSON = data
        lock.unlock()
    }

    // MARK: - Connection handling

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, buffer: Data())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }
            var buffer = buffer
            if let data {
                buffer.append(data)
            }
            if let request = self.parse(buffer) {
                let response = self.route(request)
                connection.send(content: response, completion: .contentProcessed { _ in
                    connection.cancel()
                })
            } else if isComplete || error != nil {
                connection.cancel()
            } else {
                self.receive(connection, buffer: buffer)
            }
        }
    }

    private struct ParsedRequest {
        let method: String
        let path: String
        let body: Data
    }

    /// Returns nil when the buffer doesn't yet hold a full request (keep reading).
    private func parse(_ buffer: Data) -> ParsedRequest? {
        let separator = Data("\r\n\r\n".utf8)
        guard let headerEnd = buffer.range(of: separator) else {
            return nil
        }
        let headerData = buffer.subdata(in: buffer.startIndex..<headerEnd.lowerBound)
        guard let headerString = String(data: headerData, encoding: .utf8) else {
            return nil
        }
        let lines = headerString.components(separatedBy: "\r\n")
        let parts = lines.first?.components(separatedBy: " ") ?? []
        guard parts.count >= 2 else {
            return nil
        }
        var contentLength = 0
        for line in lines.dropFirst() where line.lowercased().hasPrefix("content-length:") {
            let value = line.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)
            contentLength = Int(value) ?? 0
        }
        let bodyStart = headerEnd.upperBound
        let available = buffer.distance(from: bodyStart, to: buffer.endIndex)
        guard available >= contentLength else {
            return nil
        }
        let bodyEnd = buffer.index(bodyStart, offsetBy: contentLength)
        let body = buffer.subdata(in: bodyStart..<bodyEnd)
        return ParsedRequest(method: parts[0], path: parts[1], body: body)
    }

    private func route(_ request: ParsedRequest) -> Data {
        let path = request.path.components(separatedBy: "?").first ?? request.path
        switch (request.method, path) {
        case ("GET", "/context"), ("GET", "/"):
            lock.lock()
            let data = contextJSON
            lock.unlock()
            return response(body: data)

        case ("GET", "/health"):
            return response(body: jsonData(["ok": true, "service": "mac-bridge"]))

        case ("POST", "/applescript"):
            guard let script = stringField("script", in: request.body) else {
                return response(status: "400 Bad Request", body: jsonData(["error": "missing 'script'"]))
            }
            let result = runAppleScript?(script) ?? (ok: false, output: "bridge action handler not ready")
            return response(body: jsonData(["ok": result.ok, "output": result.output]))

        case ("POST", "/open-url"):
            guard let url = stringField("url", in: request.body) else {
                return response(status: "400 Bad Request", body: jsonData(["error": "missing 'url'"]))
            }
            let ok = openURL?(url) ?? false
            return response(body: jsonData(["ok": ok]))

        default:
            return response(status: "404 Not Found", body: jsonData(["error": "unknown route"]))
        }
    }

    // MARK: - Helpers

    private func stringField(_ key: String, in body: Data) -> String? {
        let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
        return object?[key] as? String
    }

    private func jsonData(_ object: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
    }

    private func response(status: String = "200 OK", body: Data) -> Data {
        var head = "HTTP/1.1 \(status)\r\n"
        head += "Content-Type: application/json\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        return Data(head.utf8) + body
    }
}
