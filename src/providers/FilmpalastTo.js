var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://filmpalast.to';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
    'DNT': '1'
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
// 2. VOE DECODER (Your Logic)
// ==========================================
function voeDecode(ct, luts) {
    try {
        console.log("[DEBUG-VOE] Decoding Payload. Length: " + ct.length);
        var rawLuts = luts.replace(/^\[|\]$/g, "").split("','").map(function(s) {
            return s.replace(/^'+|'+$/g, "");
        });
        var escapedLuts = rawLuts.map(function(i) {
            return i.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        });
        
        var txt = "";
        for (var ci = 0; ci < ct.length; ci++) {
            var x = ct.charCodeAt(ci);
            if (x > 64 && x < 91) x = (x - 52) % 26 + 65;
            else if (x > 96 && x < 123) x = (x - 84) % 26 + 97;
            txt += String.fromCharCode(x);
        }

        for (var pi = 0; pi < escapedLuts.length; pi++) {
            txt = txt.replace(new RegExp(escapedLuts[pi], "g"), "_");
        }
        txt = txt.split("_").join("");

        var decoded1 = b64decode(txt);
        if (!decoded1) return null;

        var step4 = "";
        for (var si = 0; si < decoded1.length; si++) {
            step4 += String.fromCharCode((decoded1.charCodeAt(si) - 3 + 256) % 256);
        }

        var revBase64 = step4.split("").reverse().join("");
        var finalStr = b64decode(revBase64);
        
        console.log("[DEBUG-VOE] Decode successful.");
        return finalStr ? JSON.parse(finalStr) : null;
    } catch (e) {
        console.log("[DEBUG-VOE] Decode Error: " + e.message);
        return null;
    }
}

async function extractVoe(embedUrl) {
    try {
        console.log("\n--- [VOE DEBUG START] ---");
        
        // 1. Initial Request
        var res = await fetch(embedUrl, { 
            headers: { 
                "Referer": "https://voe.sx/",
                "User-Agent": DEFAULT_HEADERS['User-Agent']
            } 
        });

        // CAPTURE COOKIES (Crucial for bypassing redirects)
        var cookie = res.headers.get('set-cookie');
        var data = await res.text();

        // If you still see nothing, this JSON stringify will force it out
        console.log("DEBUG_RAW_INITIAL: " + JSON.stringify(data.substring(0, 500)));

        var redirectMatch = data.match(/window\.location\.href\s*=\s*['"](https:\/\/[^'"]+)['"]/i);
        
        if (redirectMatch && redirectMatch[1].indexOf('voe.sx') === -1) {
            var jumpUrl = redirectMatch[1];
            console.log("[3] REDIRECT DETECTED -> " + jumpUrl);
            
            // 2. Middleman Request with Cookies
            var res2 = await fetch(jumpUrl, { 
                headers: { 
                    "Referer": embedUrl,
                    "Cookie": cookie, // Pass the cookie back
                    "User-Agent": DEFAULT_HEADERS['User-Agent']
                } 
            });
            data = await res2.text();

            // --- THE "I MUST SEE THE CODE" BLOCK ---
            console.log("!!! MANIFESTING HTML !!!");
            var cleanData = data.replace(/\s+/g, ' '); // Remove extra whitespace
            for (var i = 0; i < cleanData.length; i += 800) {
                // We use a prefix to ensure the console doesn't ignore the line
                process.stdout.write(">>DATA_CHUNK>> " + cleanData.substring(i, i + 800) + "\n");
            }
        }

        if (data.indexOf('Checking your browser') !== -1 || data.includes('cf-challenge')) {
            console.log("!!! ALERT: Blocked by Cloudflare on Middleman.");
            return null;
        }

        // 3. Extraction Logic
        var rMain = data.match(/json">\s*\[?\s*['"]([^'"]+)['"]\s*\]?\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
        
        if (rMain) {
            var encodedArray = rMain[1];
            var loaderUrl = resolveRelativeUrl(rMain[2], embedUrl);
            var jsRes = await fetch(loaderUrl, { headers: { "Referer": jumpUrl || embedUrl } });
            var jsData = await jsRes.text();
            
            var replMatch = jsData.match(/(\[(?:'[^']{1,10}'[\s,]*){4,12}\])/i);
            
            if (replMatch) {
                var decoded = voeDecode(encodedArray, replMatch[1]);
                if (decoded) return decoded.source || decoded.direct_access_url;
            }
        }

        // Final Fallback for raw HLS links
        var hlsMatch = data.match(/'hls'\s*:\s*'([^']+)'/i) || data.match(/"hls"\s*:\s*"([^"]+)"/i);
        if (hlsMatch) return hlsMatch[1];

    } catch (err) {
        console.log("[VOE EXCEPTION] " + err.message);
    }
    return null;
}
// --- VIDARA EXTRACTOR ---
async function extractVidara(urlStr) {
    try {
        console.log("[DEBUG-Vidara] Extracting: " + urlStr);
        var filecodeMatch = urlStr.match(/\/(?:e|v|f)\/([a-zA-Z0-9]+)/);
        if (!filecodeMatch) return null;

        var apiBase = urlStr.split('/')[0] + '//' + urlStr.split('/')[2];
        
        // Fetch embed page to grab tokens/keys
        var pageRes = await fetch(urlStr, { headers: DEFAULT_HEADERS });
        var pageHtml = await pageRes.text();
        
        var tokenMatch = pageHtml.match(/key:\s*['"]([^'"]+)['"]/i);
        var token = tokenMatch ? tokenMatch[1] : null;
        console.log("[DEBUG-Vidara] Extracted Key Token: " + (token ? "YES" : "NO"));

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
        if (streamUrl) {
            console.log("[DEBUG-Vidara] Stream Found!");
            return streamUrl;
        } else {
            console.log("[DEBUG-Vidara] API returned no URL. Data: " + JSON.stringify(data));
        }
    } catch (e) { 
        console.log("[DEBUG-Vidara] Exception: " + e.message); 
    }
    return null;
}

// ==========================================
// 4. MAIN SCRAPER
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
            headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'term=' + encodeURIComponent(idData.imdb_id)
        });
        
        var movieList = await searchRes.json();
        if (!movieList || movieList.length === 0) return [];
        
        var targetTitle = movieList.find(t => t.toLowerCase().indexOf('english') === -1) || movieList[0];
        var searchPageUrl = BASE_URL + '/search/title/' + encodeURIComponent(targetTitle);
        var searchHtml = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        var $search = cheerio.load(searchHtml);
        
        var streamAnchor = $search('a[href*="/stream/"]').first();
        var streamPageUrl = streamAnchor.length > 0 ? BASE_URL + streamAnchor.attr('href').replace('/filmpalast.to', '') : (searchHtml.indexOf('currentStreamLinks') !== -1 ? searchPageUrl : null);

        if (!streamPageUrl) return [];

        var streamPageHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        var $stream = cheerio.load(streamPageHtml);
        var anchors = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();

        for (var i = 0; i < anchors.length; i++) {
            var aHref = $stream(anchors[i]).attr('href');
            if (!aHref || aHref.indexOf('javascript') !== -1) continue;
            var fullUrl = aHref.indexOf('//') === 0 ? 'https:' + aHref : (aHref.indexOf('http') === 0 ? aHref : 'https://' + aHref);
            
            if (fullUrl.indexOf('voe.sx') !== -1) {
                var direct = await extractVoe(fullUrl);
                if (direct) results.push({ url: direct, meta: { title: "VOE \xB7 1080p", countryCodes: ['de'] } });
            } else if (fullUrl.indexOf('vidara.') !== -1 || fullUrl.indexOf('vidfast.') !== -1) {
                var direct = await extractVidara(fullUrl);
                if (direct) results.push({ url: direct, meta: { title: "Vidara \xB7 1080p", countryCodes: ['de'] } });
            }
        }
    } catch (e) { console.log("[DEBUG-FP] Global Error: " + e.message); }
    
    console.log("[DEBUG-FP] Final Count: " + results.length);
    return results;
}

module.exports = { getStreams };
