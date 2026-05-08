// ==========================================
// FILMPALAST.TO - Nuvio Plugin (with Cookie Jar)
// ==========================================

const cheerio = require('cheerio-without-node-native');

const BASE_URL = 'https://filmpalast.to';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
};

// Cookie Jar
let cookieJar = {};

async function fetchWithCookies(url, options = {}) {
    try {
        const headers = { ...DEFAULT_HEADERS, ...options.headers };

        // Add cookies for this domain
        try {
            const domain = url.match(/https?:\/\/([^/]+)/)[1];
            if (cookieJar[domain]) {
                headers['Cookie'] = Object.entries(cookieJar[domain])
                    .map(([k, v]) => `${k}=${v}`)
                    .join('; ');
            }
        } catch (e) {}

        const response = await fetch(url, { ...options, headers });

        // Save Set-Cookie
        const setCookieHeader = response.headers.get('set-cookie');
        if (setCookieHeader) {
            try {
                const domain = url.match(/https?:\/\/([^/]+)/)[1];
                if (!cookieJar[domain]) cookieJar[domain] = {};

                const cookies = setCookieHeader.split(/,\s*(?=\w)/);
                cookies.forEach(cookie => {
                    const [part] = cookie.split(';');
                    const [name, value] = part.split('=').map(x => x.trim());
                    if (name && value) {
                        cookieJar[domain][name] = value;
                    }
                });
            } catch (e) {}
        }

        return response;
    } catch (err) {
        console.log("[Fetch Error]", err.message);
        return null;
    }
}

// ====================== HELPERS ======================
function b64decode(str) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let result = "", i = 0;
    let s = str.replace(/[^A-Za-z0-9+/]/g, "");

    while (i < s.length) {
        const a = chars.indexOf(s[i++]);
        const b = chars.indexOf(s[i++]);
        const c = i < s.length ? chars.indexOf(s[i++]) : -1;
        const d = i < s.length ? chars.indexOf(s[i++]) : -1;
        const n = (a << 18) | (b << 12) | ((c === -1 ? 0 : c) << 6) | (d === -1 ? 0 : d);
        result += String.fromCharCode((n >> 16) & 255);
        if (c !== -1) result += String.fromCharCode((n >> 8) & 255);
        if (d !== -1) result += String.fromCharCode(n & 255);
    }
    return result;
}

function resolveRelativeUrl(href, base) {
    if (href.startsWith("http")) return href;
    const match = base.match(/^(https?:\/\/[^/]+)/);
    const origin = match ? match[1] : "";
    if (href.startsWith("/")) return origin + href;
    return base.substring(0, base.lastIndexOf("/") + 1) + href;
}

// ====================== VOE ======================
async function extractVoe(embedUrl) {
    try {
        let res = await fetchWithCookies(embedUrl, { 
            headers: { "Referer": "https://voe.sx/" } 
        });
        if (!res) return null;

        let html = await res.text();

        // Redirect handling
        const redirectMatch = html.match(/window\.location\.href\s*=\s*['"](https?:\/\/[^'"]+)['"]/i);
        if (redirectMatch) {
            res = await fetchWithCookies(redirectMatch[1], { 
                headers: { "Referer": embedUrl } 
            });
            html = res ? await res.text() : "";
        }

        if (html.includes("cf-challenge") || html.includes("Checking your browser")) {
            console.log("[VOE] Cloudflare detected");
            return null;
        }

        // Main VOE pattern
        const mainMatch = html.match(/json">\s*\[?\s*['"]([^'"]+)['"]\s*\]?\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
        if (mainMatch) {
            const loaderUrl = resolveRelativeUrl(mainMatch[2], embedUrl);
            const jsRes = await fetchWithCookies(loaderUrl);
            if (jsRes) {
                const jsText = await jsRes.text();
                const lutMatch = jsText.match(/(\[(?:'\S{1,30}'[\s,]*){3,30}\])/i);

                if (lutMatch) {
                    const decoded = voeDecode(mainMatch[1], lutMatch[1]);
                    if (decoded) {
                        return decoded.source || decoded.direct_access_url || decoded.file || decoded.url;
                    }
                }
            }
        }

        // HLS fallback
        const hlsMatch = html.match(/["']hls["']\s*:\s*["']([^"']+)["']/i);
        if (hlsMatch) return hlsMatch[1];

    } catch (e) {
        console.log("[VOE Error]", e.message);
    }
    return null;
}

function voeDecode(ct, luts) {
    try {
        let lutStr = luts.trim();
        if (lutStr.startsWith('[') && lutStr.endsWith(']')) lutStr = lutStr.slice(1, -1);

        const patterns = lutStr.split("','").map(s => s.replace(/^'+|'+$/g, "").trim());

        let txt = "";
        for (let i = 0; i < ct.length; i++) {
            let x = ct.charCodeAt(i);
            if (x > 64 && x < 91) x = (x - 52) % 26 + 65;
            else if (x > 96 && x < 123) x = (x - 84) % 26 + 97;
            txt += String.fromCharCode(x);
        }

        patterns.forEach(p => {
            if (p) txt = txt.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "");
        });

        let d1 = b64decode(txt);
        let d2 = "";
        for (let i = 0; i < d1.length; i++) {
            d2 += String.fromCharCode((d1.charCodeAt(i) - 3 + 256) % 256);
        }

        const finalStr = b64decode(d2.split("").reverse().join(""));
        return finalStr ? JSON.parse(finalStr) : null;
    } catch (e) {
        console.log("[VOE Decode Failed]");
        return null;
    }
}

// ====================== MAIN FUNCTION ======================
async function getStreams(tmdbId, mediaType, season = null, episode = null) {
    const results = [];

    try {
        console.log(`[Filmpalast] Searching TMDB ID: ${tmdbId} (${mediaType})`);

        const tmdbType = mediaType === 'series' ? 'tv' : 'movie';
        const idRes = await fetchWithCookies(`${TMDB_BASE_URL}/${tmdbType}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
        const idData = idRes ? await idRes.json() : null;

        if (!idData?.imdb_id) {
            console.log("[Filmpalast] No IMDB ID found");
            return [];
        }

        const searchRes = await fetchWithCookies(BASE_URL + '/autocomplete.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'term=' + encodeURIComponent(idData.imdb_id)
        });

        const movieList = searchRes ? await searchRes.json() : [];
        if (!movieList.length) return [];

        const targetTitle = movieList.find(t => !t.toLowerCase().includes('english')) || movieList[0];

        const searchHtmlRes = await fetchWithCookies(BASE_URL + '/search/title/' + encodeURIComponent(targetTitle));
        const searchHtml = searchHtmlRes ? await searchHtmlRes.text() : "";
        const $search = cheerio.load(searchHtml);

        let streamHref = $search('a[href*="/stream/"]').first().attr('href');
        if (!streamHref) return [];

        let streamPageUrl = BASE_URL + (streamHref.startsWith('/') ? streamHref : '/' + streamHref);

        const pageRes = await fetchWithCookies(streamPageUrl);
        const pageHtml = pageRes ? await pageRes.text() : "";
        const $ = cheerio.load(pageHtml);

        const anchors = $('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();

        for (const anchor of anchors) {
            let href = $(anchor).attr('href');
            if (!href || href.includes('javascript')) continue;

            let fullUrl = href.startsWith('//') ? 'https:' + href :
                         (href.startsWith('http') ? href : 'https://' + href);

            let direct = null;
            if (fullUrl.includes('voe.sx') || fullUrl.includes('voe-') || fullUrl.includes('unblock')) {
                direct = await extractVoe(fullUrl);
            } else if (fullUrl.includes('vidara.') || fullUrl.includes('vidfast.')) {
                // You can add Vidara later
            }

            if (direct) {
                results.push({
                    name: "Filmpalast",
                    title: "VOE 1080p",
                    url: direct,
                    quality: "1080p",
                    countryCodes: ["de"]
                });
            }
        }
    } catch (e) {
        console.log("[Filmpalast Main Error]", e.message);
    }

    console.log(`[Filmpalast] Finished - Found ${results.length} streams`);
    return results;
}

module.exports = { getStreams };
