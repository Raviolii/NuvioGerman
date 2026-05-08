var cheerio = require('cheerio-without-node-native');
var BASE_URL = 'https://filmpalast.to';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';
var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
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
// 2. IMPROVED VOE DECODER
// ==========================================
function voeDecode(ct, luts) {
    try {
        console.log("[DEBUG-VOE] Decoding Payload. Length: " + ct.length);
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
        console.log("[DEBUG-VOE] Decode Error: " + e.message);
        return null;
    }
}
// ==========================================
// 3. VOE EXTRACTOR with Enhanced Debugging
// ==========================================
async function extractVoe(embedUrl) {
    try {
        console.log("\n=== [VOE DEBUG START] ===");
        console.log("[VOE] Embed URL:", embedUrl);
        // 1. Initial Request
        var res = await fetch(embedUrl, {
            headers: {
                "Referer": "https://voe.sx/",
                "User-Agent": DEFAULT_HEADERS['User-Agent']
            }
        });
        var data = await res.text();
        console.log(`[VOE] Initial HTML Length: ${data.length}`);
        // === DEBUG: Show beginning of HTML ===
        console.log("[VOE] HTML Preview (first 800 chars):");
        console.log(data.substring(0, 800));
        // Handle redirect
        var redirectMatch = data.match(/window\.location\.href\s*=\s*['"](https:\/\/[^'"]+)['"]/i);
        if (redirectMatch) {
            var jumpUrl = redirectMatch[1];
            console.log("[VOE] 🔄 Redirect detected →", jumpUrl);
            var res2 = await fetch(jumpUrl, {
                headers: {
                    "Referer": embedUrl,
                    "User-Agent": DEFAULT_HEADERS['User-Agent']
                }
            });
            data = await res2.text();
            console.log(`[VOE] After Redirect - HTML Length: ${data.length}`);
            console.log("[VOE] HTML Preview after redirect:");
            console.log(data.substring(0, 900));
        }
        if (data.includes('Checking your browser') || data.includes('cf-challenge')) {
            console.log("❌ [VOE] Cloudflare / Bot Protection detected!");
            return null;
        }
        // 2. Look for encoded data + script
        var rMain = data.match(/json">\s*\[?\s*['"]([^'"]+)['"]\s*\]?\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
      
        if (rMain) {
            console.log("✅ [VOE] Found encoded JSON + loader script");
            var encodedArray = rMain[1];
            var loaderUrl = resolveRelativeUrl(rMain[2], embedUrl);
            console.log("[VOE] Loader Script URL:", loaderUrl);
            var jsRes = await fetch(loaderUrl, { headers: { "Referer": embedUrl } });
            var jsData = await jsRes.text();
            console.log(`[VOE] Loader JS Length: ${jsData.length}`);
            console.log("[VOE] Loader JS Preview:");
            console.log(jsData.substring(0, 700));
            // Find LUT array
            var replMatch = jsData.match(/(\[(?:'\S{1,30}'[\s,]*){3,30}\])/i);
            if (replMatch) {
                console.log("✅ [VOE] LUT Array found!");
                console.log("[VOE] LUT Sample:", replMatch[1].substring(0, 150) + "...");
              
                var decoded = voeDecode(encodedArray, replMatch[1]);
                if (decoded) {
                    console.log("🎉 [VOE] Decode SUCCESS!");
                    console.log("[VOE] Decoded Keys:", Object.keys(decoded));
                    const streamUrl = decoded.source || decoded.direct_access_url || decoded.file;
                    console.log("[VOE] Final Stream URL:", streamUrl);
                    return streamUrl;
                } else {
                    console.log("❌ [VOE] Decode returned null");
                }
            } else {
                console.log("❌ [VOE] LUT array not found in JS");
            }
        } else {
            console.log("❌ [VOE] Main encoded pattern not found");
        }
        // Fallback HLS search
        var hlsMatch = data.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i) ||
                       data.match(/"hls"\s*:\s*"([^"]+)"/i);
        if (hlsMatch) {
            console.log("✅ [VOE] HLS fallback found:", hlsMatch[1]);
            return hlsMatch[1];
        }
        console.log("❌ [VOE] No stream found");
    } catch (err) {
        console.log("💥 [VOE EXCEPTION]", err.message);
    }
    return null;
}
// ==========================================
// VIDARA EXTRACTOR (unchanged)
// ==========================================
async function extractVidara(urlStr) {
    try {
        console.log("[DEBUG-Vidara] Extracting:", urlStr);
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
        return data?.streaming_url || data?.url || null;
    } catch (e) {
        console.log("[DEBUG-Vidara] Exception:", e.message);
        return null;
    }
}
// ==========================================

async function getStreams(tmdbId) {
    var results = [];
    console.log("[DEBUG-FP] Starting movie search for TMDB ID:", tmdbId);
    
    try {
        // 1. Get IMDB ID from TMDB (Strictly for movies now)
        var tmdbUrl = TMDB_BASE_URL + '/movie/' + tmdbId + '/external_ids?api_key=' + TMDB_API_KEY;
        var idData = await fetch(tmdbUrl).then(r => r.json());
        
        if (!idData.imdb_id) {
            console.log("[DEBUG-FP] No IMDB ID found for this movie.");
            return [];
        }

        // 2. Search Filmpalast via Autocomplete using IMDB ID
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

        // 3. Select target title (Filtering out English versions if present)
        var targetTitle = movieList.find(t => !t.toLowerCase().includes('english')) || movieList[0];
        var searchPageUrl = BASE_URL + '/search/title/' + encodeURIComponent(targetTitle);
        
        var searchHtml = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        var $search = cheerio.load(searchHtml);
        
        // 4. Find the stream page link
        var streamAnchor = $search('a[href*="/stream/"]').first();
        var streamPageUrl = streamAnchor.length > 0
            ? BASE_URL + streamAnchor.attr('href').replace('/filmpalast.to', '')
            : null;

        if (!streamPageUrl) return [];

        // 5. Extract hoster links from the stream page
        var streamPageHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        var $stream = cheerio.load(streamPageHtml);
        var anchors = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();

        for (var anchor of anchors) {
            var aHref = $stream(anchor).attr('href');
            if (!aHref || aHref.includes('javascript')) continue;

            var fullUrl = aHref.startsWith('//') ? 'https:' + aHref
                        : (aHref.startsWith('http') ? aHref : 'https://' + aHref);

            // VOE Extraction
            if (fullUrl.includes('voe.sx') || fullUrl.includes('voe-') || fullUrl.includes('unblock')) {
                var direct = await extractVoe(fullUrl);
                if (direct) {
                    results.push({ url: direct, meta: { title: "VOE · 1080p", countryCodes: ['de'] } });
                }
            }
            // Vidara Extraction
            else if (fullUrl.includes('vidara.') || fullUrl.includes('vidfast.')) {
                var direct = await extractVidara(fullUrl);
                if (direct) {
                    results.push({ url: direct, meta: { title: "Vidara · 1080p", countryCodes: ['de'] } });
                }
            }
        }
    } catch (e) {
        console.log("[DEBUG-FP] Global Error:", e.message);
    }

    console.log(`[DEBUG-FP] Finished. Found ${results.length} movie streams.`);
    return results;
}
module.exports = { getStreams };
