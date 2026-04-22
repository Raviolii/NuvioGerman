var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://filmpalast.to';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': BASE_URL
};

// ==========================================
// 1. HELPER UTILS
// ==========================================
function b64decode(str) {
    try {
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
    } catch(e) { 
        return null; 
    }
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
// 2. VOE DECODER
// ==========================================
// ==========================================
// 2. VOE DECODER (With Buffer Checks)
// ==========================================
function voeDecode(ct, luts) {
    try {
        console.log("[DEBUG-VOE-LOGIC] Payload Start: " + ct.substring(0, 30) + "...");
        
        var rawLuts = luts.replace(/^\[|\]$/g, "").split("','").map(function(s) {
            return s.replace(/^'+|'+$/g, "");
        });
        
        var escapedLuts = rawLuts.map(function(i) {
            return i.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        });

        // Step 1: ROT13
        var txt = "";
        for (var ci = 0; ci < ct.length; ci++) {
            var x = ct.charCodeAt(ci);
            if (x > 64 && x < 91) x = ((x - 65 + 13) % 26) + 65;
            else if (x > 96 && x < 123) x = ((x - 97 + 13) % 26) + 97;
            txt += String.fromCharCode(x);
        }

        // Step 2: Junk Removal
        var beforeScrub = txt.length;
        for (var pi = 0; pi < escapedLuts.length; pi++) {
            txt = txt.replace(new RegExp(escapedLuts[pi], "g"), "");
        }
        console.log("[DEBUG-VOE-LOGIC] Scrubbed " + (beforeScrub - txt.length) + " junk chars.");

        // Step 3: Base64 Pass 1
        var decoded1 = b64decode(txt);
        if (!decoded1) {
            console.log("[DEBUG-VOE-LOGIC] FAILED: Initial B64 decode returned null.");
            return null;
        }

        // Step 4: Char-code Offset (-3)
        var step4 = "";
        for (var si = 0; si < decoded1.length; si++) {
            step4 += String.fromCharCode((decoded1.charCodeAt(si) - 3 + 256) % 256);
        }

        // Step 5: Reverse & Final B64
        var revBase64 = step4.split("").reverse().join("");
        var finalStr = b64decode(revBase64);
        
        if (!finalStr) {
            console.log("[DEBUG-VOE-LOGIC] FAILED: Final reversed B64 decode failed.");
            return null;
        }

        return JSON.parse(finalStr);
    } catch (e) {
        console.log("[DEBUG-VOE-LOGIC] CRITICAL ERROR: " + e.message);
        return null;
    }
}

// ==========================================
// 3. UPDATED VOE EXTRACTOR
// ==========================================
async function extractVoe(url) {
    try {
        console.log("[DEBUG-VOE-HTML] Requesting URL: " + url);
        var response = await fetch(url, { headers: DEFAULT_HEADERS });
        var html = await response.text();

        // Check for common bot protection triggers
        if (html.indexOf('Checking your browser') !== -1 || html.indexOf('cloudflare') !== -1) {
            console.log("[DEBUG-VOE-HTML] FAILED: Cloudflare/DDoS protection detected.");
            return null;
        }

        // DEBUG: Find all script tags to see where they hide the data
        var scriptCount = (html.match(/<script/g) || []).length;
        console.log("[DEBUG-VOE-HTML] Script tags found on page: " + scriptCount);

        // Regex 1: The standard LaMovie / 2026 pattern
        var rMain = html.match(/json">\s*\[?\s*['"]([^'"]+)['"]\s*\]?\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
        
        if (rMain) {
            console.log("[DEBUG-VOE-HTML] Match Found! Payload Len: " + rMain[1].length);
            var encodedPayload = rMain[1];
            var loaderUrl = resolveRelativeUrl(rMain[2], url);
            console.log("[DEBUG-VOE-HTML] Fetching LUT Script from: " + loaderUrl);
            
            var jsRes = await fetch(loaderUrl, { headers: { 'Referer': url } });
            var jsData = await jsRes.text();

            // Check if the JS loader actually contains the LUT array
            var replMatch = jsData.match(/(\[(?:'[^']{1,10}'[\s,]*){4,12}\])/i) || 
                            jsData.match(/(\[(?:"[^"]{1,10}"[,\s]*){4,12}\])/i);
            
            if (replMatch) {
                console.log("[DEBUG-VOE-HTML] LUT Array found in JS.");
                var decoded = voeDecode(encodedPayload, replMatch[1]);
                if (decoded && (decoded.source || decoded.direct_access_url)) {
                    return decoded.source || decoded.direct_access_url;
                }
            } else {
                console.log("[DEBUG-VOE-HTML] FAILED: JS Loader present but LUT array missing.");
            }
        } else {
            // Log a small chunk of HTML near where the script should be
            console.log("[DEBUG-VOE-HTML] FAILED: Regex 1 did not match.");
            var bodyIndex = html.indexOf('<body');
            if (bodyIndex !== -1) {
                console.log("[DEBUG-VOE-HTML] HTML Snippet (Body Start): " + html.substring(bodyIndex, bodyIndex + 200).replace(/\s+/g, ' '));
            }
        }

        // Fallback: Check for 'wc' or 'ws' patterns often used in mobile/legacy VOE
        console.log("[DEBUG-VOE-HTML] Attempting Legacy/Mobile Fallback...");
        var legacyMatch = html.match(/window\.(?:wc|ws)\s*=\s*['"]([^'"]+)['"]/i);
        if (legacyMatch) {
             console.log("[DEBUG-VOE-HTML] Found legacy window variable. Decoding...");
             return b64decode(legacyMatch[1]);
        }

    } catch (e) {
        console.log("[DEBUG-VOE-HTML] EXCEPTION: " + e.message);
    }
    return null;
}

// --- VIDARA ---
async function extractVidara(urlStr) {
    try {
        console.log("[DEBUG-Vidara] Extracting: " + urlStr);
        var filecodeMatch = urlStr.match(/\/(?:e|v|f)\/([a-zA-Z0-9]+)/);
        if (!filecodeMatch) return null;

        var apiBase = urlStr.split('/')[0] + '//' + urlStr.split('/')[2];
        
        // Fetch embed page to get session tokens/keys
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
        if (streamUrl) {
            console.log("[DEBUG-Vidara] SUCCESS");
            return streamUrl;
        }
    } catch (e) { 
        console.log("[DEBUG-Vidara] Error: " + e.message); 
    }
    return null;
}

// ==========================================
// 4. MAIN SCRAPER
// ==========================================
async function getStreams(tmdbId, mediaType) {
    var results = [];
    console.log("[DEBUG-FP] START Scrape for: " + tmdbId);
    
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
            
            // --- Logic for VOE ---
            if (fullUrl.indexOf('voe.sx') !== -1) {
                var direct = await extractVoe(fullUrl);
                if (direct) results.push({ url: direct, meta: { title: "VOE \xB7 1080p", countryCodes: ['de'] } });
            } 
            // --- Logic for Vidara/Vidfast ---
            else if (fullUrl.indexOf('vidara.') !== -1 || fullUrl.indexOf('vidfast.') !== -1) {
                var direct = await extractVidara(fullUrl);
                if (direct) results.push({ url: direct, meta: { title: "Vidara \xB7 1080p", countryCodes: ['de'] } });
            }
        }
    } catch (e) { 
        console.log("[DEBUG-FP] Fatal Error: " + e.message); 
    }

    console.log("[DEBUG-FP] FINISHED. Found: " + results.length);
    return results;
}

module.exports = { getStreams };
