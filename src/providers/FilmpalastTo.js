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
        console.log("[DEBUG-B64] Error decoding string: " + e.message);
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
// 2. VOE DECODER (With Internal Debugging)
// ==========================================
function voeDecode(ct, luts) {
    try {
        console.log("[DEBUG-VOE] Starting Decode. Payload Length: " + ct.length);
        
        var rawLuts = luts.replace(/^\[|\]$/g, "").split("','").map(function(s) {
            return s.replace(/^'+|'+$/g, "");
        });
        var escapedLuts = rawLuts.map(function(i) {
            return i.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        });

        // Step 1: Alpha Rotation
        var txt = "";
        for (var ci = 0; ci < ct.length; ci++) {
            var x = ct.charCodeAt(ci);
            if (x > 64 && x < 91) x = ((x - 65 + 13) % 26) + 65;
            else if (x > 96 && x < 123) x = ((x - 97 + 13) % 26) + 97;
            txt += String.fromCharCode(x);
        }
        console.log("[DEBUG-VOE] Step 1 (Rotation) Complete.");

        // Step 2: Junk Scrubbing
        for (var pi = 0; pi < escapedLuts.length; pi++) {
            txt = txt.replace(new RegExp(escapedLuts[pi], "g"), "");
        }
        console.log("[DEBUG-VOE] Step 2 (Scrubbing) Complete.");

        // Step 3: First B64 Pass
        var decoded1 = b64decode(txt);
        if (!decoded1) throw new Error("First Base64 decode failed");

        // Step 4: Shift-Back Logic
        var step4 = "";
        for (var si = 0; si < decoded1.length; si++) {
            step4 += String.fromCharCode((decoded1.charCodeAt(si) - 3 + 256) % 256);
        }
        console.log("[DEBUG-VOE] Step 4 (Shift-Back) Complete.");

        // Step 5: Reverse & Final Pass
        var revBase64 = step4.split("").reverse().join("");
        var finalStr = b64decode(revBase64);
        
        if (!finalStr) throw new Error("Final Base64 decode failed");
        
        var json = JSON.parse(finalStr);
        console.log("[DEBUG-VOE] SUCCESS. Source: " + (json.source || json.direct_access_url));
        return json;
    } catch (e) {
        console.log("[DEBUG-VOE] Decode Logic Exception: " + e.message);
        return null;
    }
}

// ==========================================
// 3. EXTRACTORS (With HTTP Debugging)
// ==========================================
async function extractVoe(url) {
    try {
        console.log("[DEBUG-VOE] Fetching Embed: " + url);
        var response = await fetch(url, { headers: DEFAULT_HEADERS });
        var html = await response.text();

        // Regex for the encoded JSON block and the script loader
        var rMain = html.match(/json">\s*\[?\s*['"]([^'"]+)['"]\s*\]?\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
        
        if (rMain) {
            var encodedPayload = rMain[1];
            var loaderUrl = resolveRelativeUrl(rMain[2], url);
            console.log("[DEBUG-VOE] Found Payload. Fetching LUT script: " + loaderUrl);
            
            var jsRes = await fetch(loaderUrl, { headers: { 'Referer': url } });
            var jsData = await jsRes.text();

            var replMatch = jsData.match(/(\[(?:'[^']{1,10}'[\s,]*){4,12}\])/i) || 
                            jsData.match(/(\[(?:"[^"]{1,10}"[,\s]*){4,12}\])/i);
            
            if (replMatch) {
                var decoded = voeDecode(encodedPayload, replMatch[1]);
                if (decoded && (decoded.source || decoded.direct_access_url)) {
                    return decoded.source || decoded.direct_access_url;
                }
            } else {
                console.log("[DEBUG-VOE] FAILED: Could not extract LUT array from JS loader.");
            }
        } else {
            console.log("[DEBUG-VOE] FAILED: Payload regex not matched in HTML.");
        }

        // Final Fallback
        console.log("[DEBUG-VOE] Attempting Fallback Regex...");
        var re = /(?:mp4|hls|file)['"\s]*:\s*['"]([^'"]+)['"]/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
            var candidate = m[1];
            if (candidate && candidate.length > 10) return candidate.indexOf("aHR0") === 0 ? b64decode(candidate) : candidate;
        }
    } catch (e) {
        console.log("[DEBUG-VOE] Extraction Exception: " + e.message);
    }
    return null;
}

// ==========================================
// 4. MAIN SCRAPER (With Flow Debugging)
// ==========================================
async function getStreams(tmdbId, mediaType) {
    var results = [];
    console.log("[DEBUG-FP] START Scrape for ID: " + tmdbId);
    
    try {
        // Step 1: ID Conversion
        var tmdbUrl = TMDB_BASE_URL + '/' + (mediaType === 'series' ? 'tv' : 'movie') + '/' + tmdbId + '/external_ids?api_key=' + TMDB_API_KEY;
        var idData = await fetch(tmdbUrl).then(r => r.json());
        if (!idData.imdb_id) {
            console.log("[DEBUG-FP] FAILED: No IMDB ID found on TMDB.");
            return [];
        }
        console.log("[DEBUG-FP] IMDB ID: " + idData.imdb_id);

        // Step 2: Search
        var searchRes = await fetch(BASE_URL + '/autocomplete.php', {
            method: 'POST',
            headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'term=' + encodeURIComponent(idData.imdb_id)
        });
        
        var movieList = await searchRes.json();
        if (!movieList || movieList.length === 0) {
            console.log("[DEBUG-FP] FAILED: No results in autocomplete for " + idData.imdb_id);
            return [];
        }
        
        var targetTitle = movieList.find(t => t.toLowerCase().indexOf('english') === -1) || movieList[0];
        console.log("[DEBUG-FP] Selected Title: " + targetTitle);

        // Step 3: Stream Page Discovery
        var searchPageUrl = BASE_URL + '/search/title/' + encodeURIComponent(targetTitle);
        var searchHtml = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        var $search = cheerio.load(searchHtml);
        
        var streamAnchor = $search('a[href*="/stream/"]').first();
        var streamPageUrl = null;

        if (streamAnchor.length > 0) {
            streamPageUrl = BASE_URL + streamAnchor.attr('href').replace('/filmpalast.to', '');
        } else if (searchHtml.indexOf('currentStreamLinks') !== -1) {
            streamPageUrl = searchPageUrl;
        }

        if (!streamPageUrl) {
            console.log("[DEBUG-FP] FAILED: Could not find stream page link.");
            return [];
        }
        console.log("[DEBUG-FP] Stream Page: " + streamPageUrl);

        // Step 4: Link Extraction
        var streamPageHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        var $stream = cheerio.load(streamPageHtml);
        var anchors = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();
        console.log("[DEBUG-FP] Found " + anchors.length + " potential hoster links.");

        for (var i = 0; i < anchors.length; i++) {
            var aHref = $stream(anchors[i]).attr('href');
            if (!aHref || aHref.indexOf('javascript') !== -1) continue;
            
            var fullUrl = aHref.indexOf('//') === 0 ? 'https:' + aHref : (aHref.indexOf('http') === 0 ? aHref : 'https://' + aHref);
            
            if (fullUrl.indexOf('voe.sx') !== -1) {
                var direct = await extractVoe(fullUrl);
                if (direct) {
                    results.push({ url: direct, meta: { title: "VOE \xB7 1080p", countryCodes: ['de'] } });
                }
            }
        }
    } catch (e) { 
        console.log("[DEBUG-FP] Fatal Error: " + e.message); 
    }

    console.log("[DEBUG-FP] FINISHED. Total Streams: " + results.length);
    return results;
}

module.exports = { getStreams };
