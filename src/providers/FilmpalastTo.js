const cheerio = require('cheerio-without-node-native');

const BASE_URL = 'https://filmpalast.to';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

// Manual Cookie Jar
let cookieJar = {};

async function fetchWithCookies(url, options = {}) {
    const headers = { ...DEFAULT_HEADERS, ...options.headers || {} };

    const domain = new URL(url).hostname;
    if (cookieJar[domain]) {
        headers['Cookie'] = Object.entries(cookieJar[domain])
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }

    const res = await fetch(url, { ...options, headers });

    // Save cookies
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
        if (!cookieJar[domain]) cookieJar[domain] = {};
        const cookies = setCookie.split(',').map(c => c.trim());
        cookies.forEach(cookieStr => {
            const [part] = cookieStr.split(';');
            const [name, value] = part.split('=').map(x => x.trim());
            if (name && value) cookieJar[domain][name] = value;
        });
    }

    return res;
}

// ==========================================
// HELPERS
// ==========================================
function b64decode(str) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let result = "";
    let i = 0;
    let s = str.replace(/[^A-Za-z0-9+/]/g, "");

    while (i < s.length) {
        const a = chars.indexOf(s[i++]);
        const b = chars.indexOf(s[i++]);
        const c = i < s.length ? chars.indexOf(s[i++]) : -1;
        const d = i < s.length ? chars.indexOf(s[i++]) : -1;

        const cb = c === -1 ? 0 : c;
        const db = d === -1 ? 0 : d;

        const n = (a << 18) | (b << 12) | (cb << 6) | db;
        result += String.fromCharCode((n >> 16) & 255);
        if (c !== -1) result += String.fromCharCode((n >> 8) & 255);
        if (d !== -1) result += String.fromCharCode(n & 255);
    }
    return result;
}

function resolveRelativeUrl(href, base) {
    if (href.startsWith("http")) return href;
    const m = base.match(/^(https?:\/\/[^/]+)/);
    const origin = m ? m[1] : "";
    if (href.startsWith("/")) return origin + href;
    const basePath = base.substring(0, base.lastIndexOf("/") + 1);
    return basePath + href;
}

// ==========================================
// VOE EXTRACTOR
// ==========================================
async function extractVoe(embedUrl) {
    try {
        let res = await fetchWithCookies(embedUrl, {
            headers: { "Referer": "https://voe.sx/" }
        });
        let data = await res.text();

        // Redirect handling
        const redirectMatch = data.match(/window\.location\.href\s*=\s*['"](https:\/\/[^'"]+)['"]/i);
        if (redirectMatch) {
            res = await fetchWithCookies(redirectMatch[1], { headers: { "Referer": embedUrl } });
            data = await res.text();
        }

        if (data.includes('cf-challenge') || data.includes('Checking your browser')) {
            console.log("[VOE] Cloudflare blocked");
            return null;
        }

        // Main encoded pattern
        const rMain = data.match(/json">\s*\[?\s*['"]([^'"]+)['"]\s*\]?\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);

        if (rMain) {
            const encodedArray = rMain[1];
            const loaderUrl = resolveRelativeUrl(rMain[2], embedUrl);

            const jsRes = await fetchWithCookies(loaderUrl, { headers: { "Referer": embedUrl } });
            const jsData = await jsRes.text();

            const replMatch = jsData.match(/(\[(?:'\S{1,30}'[\s,]*){3,30}\])/i);

            if (replMatch) {
                const decoded = voeDecode(encodedArray, replMatch[1]);
                if (decoded) {
                    const streamUrl = decoded.source || decoded.direct_access_url || decoded.file || decoded.url;
                    if (streamUrl) return streamUrl;
                }
            }
        }

        // HLS Fallback
        const hlsMatch = data.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i) || 
                        data.match(/"hls"\s*:\s*"([^"]+)"/i);
        if (hlsMatch?.[1]) return hlsMatch[1];

    } catch (e) {
        console.log("[VOE] Error:", e.message);
    }
    return null;
}

function voeDecode(ct, luts) {
    try {
        let lutStr = luts.trim();
        if (lutStr.startsWith('[') && lutStr.endsWith(']')) lutStr = lutStr.slice(1, -1);

        const rawLuts = lutStr.split("','").map(s => s.replace(/^'+|'+$/g, "").trim());
        const patterns = rawLuts.map(item => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

        let txt = "";
        for (let i = 0; i < ct.length; i++) {
            let x = ct.charCodeAt(i);
            if (x > 64 && x < 91) x = (x - 52) % 26 + 65;
            else if (x > 96 && x < 123) x = (x - 84) % 26 + 97;
            txt += String.fromCharCode(x);
        }

        for (let pattern of patterns) {
            if (pattern) txt = txt.replace(new RegExp(pattern, "g"), "");
        }

        let decoded1 = b64decode(txt);
        if (!decoded1) return null;

        let step4 = "";
        for (let i = 0; i < decoded1.length; i++) {
            let code = decoded1.charCodeAt(i);
            step4 += String.fromCharCode((code - 3 + 256) % 256);
        }

        let revBase64 = step4.split("").reverse().join("");
        let finalStr = b64decode(revBase64);

        return finalStr ? JSON.parse(finalStr) : null;
    } catch (e) {
        console.log("[VOE Decode Error]", e.message);
        return null;
    }
}

// ==========================================
// VIDARA EXTRACTOR
// ==========================================
async function extractVidara(urlStr) {
    try {
        const filecodeMatch = urlStr.match(/\/(?:e|v|f)\/([a-zA-Z0-9]+)/);
        if (!filecodeMatch) return null;

        const apiBase = urlStr.split('/')[0] + '//' + urlStr.split('/')[2];

        const pageRes = await fetchWithCookies(urlStr);
        const pageHtml = await pageRes.text();

        const tokenMatch = pageHtml.match(/key:\s*['"]([^'"]+)['"]/i);
        const token = tokenMatch ? tokenMatch[1] : null;

        const response = await fetchWithCookies(apiBase + '/api/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Referer': urlStr,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                filecode: filecodeMatch[1],
                device: 'web',
                key: token
            })
        });

        const data = await response.json();
        return data?.streaming_url || data?.url || null;
    } catch (e) {
        console.log("[Vidara] Error:", e.message);
        return null;
    }
}

// ==========================================
// MAIN FUNCTION
// ==========================================
async function getStreams(tmdbId, mediaType, season = null, episode = null) {
    const results = [];

    try {
        // Get IMDB ID from TMDB
        const tmdbType = mediaType === 'series' ? 'tv' : 'movie';
        const idRes = await fetch(`${TMDB_BASE_URL}/${tmdbType}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
        const idData = await idRes.json();

        if (!idData.imdb_id) return [];

        // Search on Filmpalast
        const searchRes = await fetchWithCookies(BASE_URL + '/autocomplete.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'term=' + encodeURIComponent(idData.imdb_id)
        });

        const movieList = await searchRes.json();
        if (!movieList || movieList.length === 0) return [];

        const targetTitle = movieList.find(t => !t.toLowerCase().includes('english')) || movieList[0];

        const searchPageUrl = BASE_URL + '/search/title/' + encodeURIComponent(targetTitle);
        const searchHtml = await (await fetchWithCookies(searchPageUrl)).text();

        const $search = cheerio.load(searchHtml);
        const streamAnchor = $search('a[href*="/stream/"]').first();

        if (!streamAnchor.length) return [];

        let streamPageUrl = BASE_URL + streamAnchor.attr('href');
        streamPageUrl = streamPageUrl.replace('/filmpalast.to', '');

        const streamPageHtml = await (await fetchWithCookies(streamPageUrl)).text();
        const $stream = cheerio.load(streamPageHtml);

        const anchors = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();

        for (const anchor of anchors) {
            let aHref = $stream(anchor).attr('href');
            if (!aHref || aHref.includes('javascript')) continue;

            let fullUrl = aHref.startsWith('//') ? 'https:' + aHref :
                          (aHref.startsWith('http') ? aHref : 'https://' + aHref);

            if (fullUrl.includes('voe.sx') || fullUrl.includes('voe-') || fullUrl.includes('unblock')) {
                const direct = await extractVoe(fullUrl);
                if (direct) {
                    results.push({
                        url: direct,
                        meta: { title: "VOE · 1080p", countryCodes: ['de'] }
                    });
                }
            }
            else if (fullUrl.includes('vidara.') || fullUrl.includes('vidfast.')) {
                const direct = await extractVidara(fullUrl);
                if (direct) {
                    results.push({
                        url: direct,
                        meta: { title: "Vidara · 1080p", countryCodes: ['de'] }
                    });
                }
            }
        }
    } catch (e) {
        console.log("[Filmpalast] Global Error:", e.message);
    }

    console.log(`[Filmpalast] Found ${results.length} streams`);
    return results;
}

// Nuvio Export
module.exports = {
    name: "Filmpalast.to",
    language: "de",
    type: ["movie", "series"],
    getStreams
};
