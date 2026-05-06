var cheerio = require('cheerio-without-node-native');
var BASE_URL = 'https://filmpalast.to';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
};

// ==========================================
// 1. HELPER UTILS
// ==========================================
function b64decode(str) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var result = "";
    var i = 0;
    var s = str.replace(/[^A-Za-z0-9+/]/g, "");
    while (i < s.length) {
        var a = chars.indexOf(s[i++]);
        var b = chars.indexOf(s[i++]);
        var c = i < s.length ? chars.indexOf(s[i++]) : -1;
        var d = i < s.length ? chars.indexOf(s[i++]) : -1;
        var cb = c === -1 ? 0 : c;
        var db = d === -1 ? 0 : d;
        var n = a << 18 | b << 12 | cb << 6 | db;
        result += String.fromCharCode(n >> 16 & 255);
        if (c !== -1) result += String.fromCharCode(n >> 8 & 255);
        if (d !== -1) result += String.fromCharCode(n & 255);
    }
    return result;
}

function resolveRelativeUrl(href, base) {
    if (href.indexOf("http") === 0) return href;
    var m = base.match(/^(https?:\/\/[^/]+)/);
    var origin = m ? m[1] : "";
    if (href.charAt(0) === "/") return origin + href;
    var basePath = base.substring(0, base.lastIndexOf("/") + 1);
    return basePath + href;
}

// ==========================================
// 2. IMPROVED VOE DECODER (Based on ResolveURL)
// ==========================================
function voeDecode(ct, luts) {
    try {
        console.log("[DEBUG-VOE] Decoding Payload. Length: " + ct.length);

        // Parse LUT array
        let lutStr = luts.trim();
        if (lutStr.startsWith('[') && lutStr.endsWith(']')) {
            lutStr = lutStr.slice(1, -1);
        }

        const rawLuts = lutStr.split("','").map(s => {
            return s.replace(/^'+|'+$/g, "").trim();
        });

        const patterns = rawLuts.map(item => {
            return item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        });

        // Step 1: Shift characters
        let txt = "";
        for (let i = 0; i < ct.length; i++) {
            let x = ct.charCodeAt(i);
            if (x > 64 && x < 91) {        // Uppercase
                x = (x - 52) % 26 + 65;
            } else if (x > 96 && x < 123) { // Lowercase
                x = (x - 84) % 26 + 97;
            }
            txt += String.fromCharCode(x);
        }

        // Step 2: Remove obfuscation patterns
        for (let pattern of patterns) {
            if (pattern) {
                txt = txt.replace(new RegExp(pattern, "g"), "");
            }
        }

        // Step 3: First base64 decode
        let decoded1 = b64decode(txt);
        if (!decoded1) {
            console.log("[DEBUG-VOE] First base64 decode failed");
            return null;
        }

        // Step 4: Shift back by 3
        let step4 = "";
        for (let i = 0; i < decoded1.length; i++) {
            let code = decoded1.charCodeAt(i);
            step4 += String.fromCharCode((code - 3 + 256) % 256);
        }

        // Step 5: Reverse + final base64 decode
        let revBase64 = step4.split("").reverse().join("");
        let finalStr = b64decode(revBase64);

        if (!finalStr) {
            console.log("[DEBUG-VOE] Final base64 decode failed");
            return null;
        }

        console.log("[DEBUG-VOE] Decode successful.");
        return JSON.parse(finalStr);

    } catch (e) {
        console.log("[DEBUG-VOE] Decode Error: " + e.message);
        return null;
    }
}

// ==========================================
// 3. VOE EXTRACTOR
// ==========================================
async function extractVoe(embedUrl) {
    try {
        console.log("\n--- [VOE DEBUG START] ---");

        var res = await fetch(embedUrl, {
            headers: {
                "Referer": "https://voe.sx/",
                "User-Agent": DEFAULT_HEADERS['User-Agent']
            }
        });

        var cookie = res.headers.get('set-cookie');
        var data = await res.text();

        // Handle redirect
        var redirectMatch = data.match(/window\.location\.href\s*=\s*['"](https:\/\/[^'"]+)['"]/i);
        if (redirectMatch) {
            var jumpUrl = redirectMatch[1];
            console.log("[VOE] Redirect detected -> " + jumpUrl);

            var res2 = await fetch(jumpUrl, {
                headers: {
                    "Referer": embedUrl,
                    "Cookie": cookie || "",
                    "User-Agent": DEFAULT_HEADERS['User-Agent']
                }
            });
            data = await res2.text();
        }

        // Cloudflare check
        if (data.includes('Checking your browser') || data.includes('cf-challenge')) {
            console.log("[VOE] Blocked by Cloudflare");
            return null;
        }

        // Main extraction
        var rMain = data.match(/json">\s*\[?\s*['"]([^'"]+)['"]\s*\]?\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);

        if (rMain) {
            var encodedArray = rMain[1];
            var loaderUrl = resolveRelativeUrl(rMain[2], embedUrl);

            var jsRes = await fetch(loaderUrl, { 
                headers: { "Referer": embedUrl } 
            });
            var jsData = await jsRes.text();

            // Improved regex for LUT array
            var replMatch = jsData.match(/(\[(?:'\S{1,25}'[\s,]*){4,25}\])/i);

            if (replMatch) {
                var decoded = voeDecode(encodedArray, replMatch[1]);
                if (decoded) {
                    return decoded.source || decoded.direct_access_url || decoded.file;
                }
            }
        }

        // Fallback: direct HLS
        var hlsMatch = data.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i);
        if (hlsMatch) return hlsMatch[1];

    } catch (err) {
        console.log("[VOE EXCEPTION] " + err.message);
    }
    return null;
}

// ==========================================
// VIDARA EXTRACTOR (unchanged)
// ==========================================
async function extractVidara(urlStr) {
    try {
        console.log("[DEBUG-Vidara] Extracting: " + urlStr);
        var filecodeMatch = urlStr.match(/\/(?:e|v|f)\/([a-zA-Z0-9]+)/);
        if (!filecodeMatch) return null;

        var apiBase = urlStr.split('/')[0] + '//' + urlStr.split('/')[2];

        var pageRes = await fetch(urlStr, { headers: DEFAULT_HEADERS });
        var pageHtml = await pageRes.text();

        var tokenMatch = pageHtml.match(/key:\s*['"]([^'"]+)['"]/i);
        var token = tokenMatch ? tokenMatch[1] : null;

        var response = await fetch(apiBase + '/api/stream', {
            method: 'POST',
            headers: {
                'User-Agent': DEFAULT_HEADERS['User-Agent'],
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

        var data = await response.json();
        var streamUrl = data && (data.streaming_url || data.url);
        if (streamUrl) return streamUrl;

    } catch (e) {
        console.log("[DEBUG-Vidara] Exception: " + e.message);
    }
    return null;
}

// ==========================================
// MAIN SCRAPER
// ==========================================
async function getStreams(tmdbId, mediaType) {
    var results = [];
    console.log("[DEBUG-FP] Searching for ID: " + tmdbId);

    try {
        var tmdbUrl = TMDB_BASE_URL + '/' + (mediaType === 'series' ? 'tv' : 'movie') + '/' + tmdbId + '/external_ids?api_key=' + TMDB_API_KEY;
        var idData = await fetch(tmdbUrl).then(r => r.json());

        if (!idData.imdb_id) return [];

        var searchRes = await fetch(BASE_URL + '/autocomplete.php', {
            method: 'POST',
            headers: { 
                'User-Agent': DEFAULT_HEADERS['User-Agent'], 
                'Content-Type': 'application/x-www-form-urlencoded' 
            },
            body: 'term=' + encodeURIComponent(idData.imdb_id)
        });

        var movieList = await searchRes.json();
        if (!movieList || movieList.length === 0) return [];

        var targetTitle = movieList.find(t => t.toLowerCase().indexOf('english') === -1) || movieList[0];
        var searchPageUrl = BASE_URL + '/search/title/' + encodeURIComponent(targetTitle);

        var searchHtml = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        var $search = cheerio.load(searchHtml);

        var streamAnchor = $search('a[href*="/stream/"]').first();
        var streamPageUrl = streamAnchor.length > 0 
            ? BASE_URL + streamAnchor.attr('href').replace('/filmpalast.to', '') 
            : null;

        if (!streamPageUrl) return [];

        var streamPageHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        var $stream = cheerio.load(streamPageHtml);

        var anchors = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();

        for (var i = 0; i < anchors.length; i++) {
            var aHref = $stream(anchors[i]).attr('href');
            if (!aHref || aHref.indexOf('javascript') !== -1) continue;

            var fullUrl = aHref.indexOf('//') === 0 ? 'https:' + aHref 
                        : (aHref.indexOf('http') === 0 ? aHref : 'https://' + aHref);

            if (fullUrl.indexOf('voe.sx') !== -1 || fullUrl.includes('voe-') || fullUrl.includes('unblock')) {
                var direct = await extractVoe(fullUrl);
                if (direct) {
                    results.push({ 
                        url: direct, 
                        meta: { title: "VOE · 1080p", countryCodes: ['de'] } 
                    });
                }
            } 
            else if (fullUrl.indexOf('vidara.') !== -1 || fullUrl.indexOf('vidfast.') !== -1) {
                var direct = await extractVidara(fullUrl);
                if (direct) {
                    results.push({ 
                        url: direct, 
                        meta: { title: "Vidara · 1080p", countryCodes: ['de'] } 
                    });
                }
            }
        }
    } catch (e) {
        console.log("[DEBUG-FP] Global Error: " + e.message);
    }

    console.log("[DEBUG-FP] Final Count: " + results.length);
    return results;
}

module.exports = { getStreams };
