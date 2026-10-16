import Foundation

/// Calls POST {endpoint}/api/refine. Foundation only (testable without UI).
/// Ephemeral session: nothing (bodies, cookies, cache) is persisted to disk.
final class RefineClient {
    let endpoint: String
    private let session: URLSession
    private let timeout: TimeInterval

    init(endpoint: String, timeout: TimeInterval = RefineCore.requestTimeout) {
        self.endpoint = endpoint
        self.timeout = timeout
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = timeout
        config.timeoutIntervalForResource = timeout
        config.waitsForConnectivity = false
        config.urlCache = nil
        if let host = URL(string: endpoint)?.host, ["127.0.0.1", "localhost", "::1"].contains(host) {
            config.connectionProxyDictionary = [:] // never route the local backend through a proxy
        }
        session = URLSession(configuration: config)
    }

    /// `completion` runs on a background queue.
    @discardableResult
    func refine(text: String, target: RefineTarget, depth: RefineDepth, language: String?,
                completion: @escaping (Result<String, RefineFailure>) -> Void) -> URLSessionDataTask? {
        guard let url = URL(string: endpoint + "/api/refine") else {
            completion(.failure(.unavailable))
            return nil
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = RefineCore.requestBody(text: text, target: target, depth: depth, language: language)
        let task = session.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(RefineCore.failure(fromTransportError: error)))
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            completion(RefineCore.parseResponse(status: status, body: data))
        }
        task.resume()
        return task
    }
}
