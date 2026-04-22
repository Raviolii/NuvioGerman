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

// ==========================================
// 3. EXTRACTORS (With Verbose Debugging)
// ==========================================

async function extractVoe(embedUrl) {
    try {
        console.log("[DEBUG-VOE] Requesting: " + embedUrl);
        var res = await fetch(embedUrl, { headers: { "Referer": embedUrl } });
        var data = await res.text();

        // Check for Redirect Landing Page
        var redirectMatch = data.match(/window\.location\.href\s*=\s*['"](https:\/\/[^'"]+)['"]/i);
        if (redirectMatch && redirectMatch[1].indexOf('voe.sx') === -1) {
            var jumpUrl = redirectMatch[1];
            console.log("[DEBUG-VOE] REDIRECT DETECTED -> " + jumpUrl);
            
            // Follow the jump
            var res2 = await fetch(jumpUrl, { headers: { "Referer": embedUrl } });
            console.log("[DEBUG-VOE] Middleman URL reached: " + res2.url);
            data = await res2.text();
            
            // If we are still on a redirect page, follow again (some proxies have 2 jumps)
            if (data.indexOf('window.location.href') !== -1 && data.length < 1000) {
                 var secondJump = data.match(/window\.location\.href\s*=\s*['"](https:\/\/[^'"]+)['"]/i);
                 if (secondJump) {
                     console.log("[DEBUG-VOE] SECOND JUMP -> " + secondJump[1]);
                     var res3 = await fetch(secondJump[1], { headers: { "Referer": jumpUrl } });
                     data = await res3.text();
                 }
            }
        }

        // Standard Extraction Logic
        var rMain = data.match(/json">\s*\[?\s*['"]([^'"]+)['"]\s*\]?\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
        if (rMain) {
            console.log("[DEBUG-VOE] Found JSON payload script.");
            var encodedArray = rMain[1];
            var loaderUrl = resolveRelativeUrl(rMain[2], embedUrl);
            
            console.log("[DEBUG-VOE] Fetching LUT Script: " + loaderUrl);
            var jsRes = await fetch(loaderUrl, { headers: { "Referer": embedUrl } });
            var jsData = await jsRes.text();
            
            var replMatch = jsData.match(/(\[(?:'[^']{1,10}'[\s,]*){4,12}\])/i) || 
                            jsData.match(/(\[(?:"[^"]{1,10}"[,\s]*){4,12}\])/i);
            
            if (replMatch) {
                var decoded = voeDecode(encodedArray, replMatch[1]);
                if (decoded && (decoded.source || decoded.direct_access_url)) {
                    return decoded.source || decoded.direct_access_url;
                }
            } else {
                console.log("[DEBUG-VOE] Failed to find LUT array in JS.");
            }
        } else {
            console.log("[DEBUG-VOE] Regex failed. HTML snippet: " + data.substring(0, 300).replace(/\s+/g, ' '));
        }

        // Final Fallback
        var re = /(?:mp4|hls|file)['"\s]*:\s*['"]([^'"]+)['"]/gi;
        var m;
        while ((m = re.exec(data)) !== null) {
            console.log("[DEBUG-VOE] Fallback match found.");
            var url = m[1];
            if (url && url.indexOf("aHR0") === 0) return b64decode(url);
            if (url && url.indexOf("http") === 0) return url;
        }
    } catch (err) {
        console.log("[DEBUG-VOE] Fatal Exception: " + err.message);
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
        if (!idData.imdb_id) {
            console.log("[DEBUG-FP] No IMDB ID found.");
            return [];
        }

        var searchRes = await fetch(BASE_URL + '/autocomplete.php', {
            method: 'POST',
            headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'term=' + encodeURIComponent(idData.imdb_id)
        });
        
        var movieList = await searchRes.json();
        if (!movieList || movieList.length === 0) {
            console.log("[DEBUG-FP] Autocomplete returned zero results.");
            return [];
        }
        
        var targetTitle = movieList.find(t => t.toLowerCase().indexOf('english') === -1) || movieList[0];
        console.log("[DEBUG-FP] Targeting title: " + targetTitle);

        var searchPageUrl = BASE_URL + '/search/title/' + encodeURIComponent(targetTitle);
        var searchHtml = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        var $search = cheerio.load(searchHtml);
        
        var streamAnchor = $search('a[href*="/stream/"]').first();
        var streamPageUrl = streamAnchor.length > 0 ? BASE_URL + streamAnchor.attr('href').replace('/filmpalast.to', '') : (searchHtml.indexOf('currentStreamLinks') !== -1 ? searchPageUrl : null);

        if (!streamPageUrl) {
            console.log("[DEBUG-FP] No stream page found.");
            return [];
        }

        var streamPageHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        var $stream = cheerio.load(streamPageHtml);
        var anchors = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();
        console.log("[DEBUG-FP] Found " + anchors.length + " links to process.");

        for (var i = 0; i < anchors.length; i++) {
            var aHref = $stream(anchors[i]).attr('href');
            if (!aHref) continue;
            var fullUrl = aHref.indexOf('//') === 0 ? 'https:' + aHref : (aHref.indexOf('http') === 0 ? aHref : 'https://' + aHref);
            
            if (fullUrl.indexOf('voe.sx') !== -1) {
                var direct = await extractVoe(fullUrl);
                if (direct) results.push({ url: direct, meta: { title: "VOE \xB7 1080p", countryCodes: ['de'] } });
            }
        }
    } catch (e) { console.log("[DEBUG-FP] Global Exception: " + e.message); }
    
    console.log("[DEBUG-FP] Finished. Found " + results.length + " streams.");
    return results;
}

module.exports = { getStreams };
