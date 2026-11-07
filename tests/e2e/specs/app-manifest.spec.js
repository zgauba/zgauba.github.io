// R3b "Save as an app": the web manifest, its icons and the head tags on every Commons page
// (plan docs/plans/R3-app-shell.md, Step 8 R3b). The test server is path-prefixed (/commons/),
// like github.io, so this also proves the relative start_url / scope stay inside the prefix.
const { test, expect } = require("@playwright/test");
const { stubBackend } = require("./stub");

const PAGES = ["./", "account/", "admin/", "events/", "home/"];

// Pixel size straight from the PNG header (IHDR width/height, bytes 16–23). Also asserts the icon is
// opaque: IHDR colour type (byte 25) 4 or 6 = alpha, which iOS fills black and Android masks badly.
function pngSize(buf) {
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect([0, 2, 3]).toContain(buf[25]);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test("manifest: 200, valid JSON, installed name Commons, start_url/scope inside /commons/, no shortcuts", async ({ request, baseURL }) => {
  const res = await request.get("manifest.webmanifest");
  expect(res.status()).toBe(200);
  const m = JSON.parse(await res.text());
  expect(m.name).toBe("Commons");
  expect(m.short_name).toBe("Commons");
  expect(m.id).toBe("/");  // frozen: a changed id makes installed copies a different app
  expect(m.display).toBe("standalone");
  expect(m.theme_color).toBe("#141210");
  expect(m.background_color).toBe("#141210");
  expect(m.shortcuts).toBeUndefined();  // R4 coordination C4
  const manifestUrl = new URL("manifest.webmanifest", baseURL);
  expect(new URL(m.start_url, manifestUrl).href).toBe(new URL("./", baseURL).href);
  expect(new URL(m.scope, manifestUrl).pathname).toBe("/commons/");
  for (const u of [m.start_url, m.scope, ...m.icons.map((i) => i.src)]) {
    expect(u.startsWith("/") || /^[a-z]+:/i.test(u)).toBe(false);  // relative only: works at / and /commons/
  }
});

test("manifest icons: each is a 200 PNG at its declared size; maskable 512 + any 192/512 present", async ({ request }) => {
  const m = JSON.parse(await (await request.get("manifest.webmanifest")).text());
  expect(m.icons.map((i) => `${i.sizes} ${i.purpose}`).sort()).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const icon of m.icons) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(icon.type).toBe("image/png");
    const { w, h } = pngSize(await res.body());
    expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
  }
  const apple = await request.get("assets/app-icons/apple-touch-icon-180.png");
  expect(apple.status()).toBe(200);
  expect(pngSize(await apple.body())).toEqual({ w: 180, h: 180 });
});

for (const path of PAGES) {
  test(`head tags on ${path}: one manifest link + iOS tags, all resolving; no CSP violation (Chromium: manifest fetched + parsed under CSP)`, async ({ page, request, baseURL, browserName }) => {
    // read the served head, not the live DOM: some pages send a signed-out visitor elsewhere
    const served = await request.get(path);
    expect(served.status()).toBe(200);
    const html = await served.text();
    const doc = { count: (re) => (html.match(re) || []).length };
    expect(doc.count(/<link rel="manifest"/g)).toBe(1);
    expect(doc.count(/<link rel="apple-touch-icon"/g)).toBe(1);
    expect(html).toContain('<meta name="theme-color" content="#141210">');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes">');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Commons">');
    // not black-translucent: that would draw every page under the iPhone status bar
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black">');
    const pageUrl = new URL(path, baseURL);
    const manifestHref = html.match(/<link rel="manifest" href="([^"]+)"/)[1];
    const appleHref = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/)[1];
    expect(new URL(manifestHref, pageUrl).href).toBe(new URL("manifest.webmanifest", baseURL).href);
    expect(new URL(appleHref, pageUrl).href).toBe(new URL("assets/app-icons/apple-touch-icon-180.png", baseURL).href);

    const csp = [];
    page.on("console", (msg) => { if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text()); });
    await stubBackend(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // the page may have moved on (signed out → account/); every Commons page carries the same tags
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    if (browserName === "chromium") {
      // Make Chromium actually fetch + parse the manifest under the page's CSP (manifest-src falls back to
      // default-src 'self'); a blocked or broken manifest shows up as errors here.
      const cdp = await page.context().newCDPSession(page);
      const got = await cdp.send("Page.getAppManifest");
      expect(got.errors).toEqual([]);
      expect(got.url).toBe(new URL("manifest.webmanifest", baseURL).href);
      expect(JSON.parse(got.data).name).toBe("Commons");
    }
    expect(csp).toEqual([]);
  });
}

test("404 page stays static: no manifest link", async ({ request }) => {
  const html = await (await request.get("404.html")).text();
  expect(html).not.toContain('rel="manifest"');
});
