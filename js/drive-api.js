async function driveGet(url, params = {}) {
    if (!driveAccessToken) throw new Error("Not authenticated");
    const qs = Object.keys(params).length
        ? "?" + new URLSearchParams(params).toString()
        : "";
    const r = await fetch(url + qs, {
        headers: { Authorization: "Bearer " + driveAccessToken },
    });
    if (!r.ok)
        throw new Error(`GET ${url} -> ${r.status}: ${await r.text()}`);
    return r.json();
    }
async function drivePost(url, metadata, textContent = null) {
    if (!driveAccessToken) throw new Error("Not authenticated");
    if (textContent === null) {
        const r = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: "Bearer " + driveAccessToken,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(metadata),
        });
        if (!r.ok)
        throw new Error(`POST ${url} -> ${r.status}: ${await r.text()}`);
        return r.json();
    } else {
        const boundary = "wb_" + Date.now();
        const body = [
        `--${boundary}`,
        "Content-Type: application/json",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        textContent,
        `--${boundary}--`,
        ].join("\r\n");
        const r = await fetch(url + "?uploadType=multipart", {
        method: "POST",
        headers: {
            Authorization: "Bearer " + driveAccessToken,
            "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
        });
        if (!r.ok)
        throw new Error(`POST multipart -> ${r.status}: ${await r.text()}`);
        return r.json();
    }
    }
async function drivePatch(fileId, textContent) {
    if (!driveAccessToken) throw new Error("Not authenticated");
    const r = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
        method: "PATCH",
        headers: {
            Authorization: "Bearer " + driveAccessToken,
            "Content-Type": "text/plain; charset=utf-8",
        },
        body: textContent,
        },
    );
    if (!r.ok)
        throw new Error(`PATCH ${fileId} -> ${r.status}: ${await r.text()}`);
    return r.json();
    }
