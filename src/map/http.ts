export type JsonResponse<T> = {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
};

function xhrJson<T>(url: string): Promise<JsonResponse<T>> {
  return new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest === "undefined") {
      reject(new Error("No browser request API is available."));
      return;
    }
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "text";
    request.onload = () => {
      const text = String(request.responseText || "");
      resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
        json: async () => JSON.parse(text) as T,
      });
    };
    request.onerror = () => reject(new Error(`Unable to load ${url}`));
    request.send();
  });
}

export function requestJson<T = unknown>(url: string): Promise<JsonResponse<T>> {
  if (typeof fetch === "function") return fetch(url) as Promise<JsonResponse<T>>;
  return xhrJson<T>(url);
}
