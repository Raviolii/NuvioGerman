var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://filmpalast.to';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0'
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
// 3. EXTRACTORS
// ==========================================

// --- VOE EXTRACTOR ---
async function extractVoe(embedUrl) {
    try {
        console.log("\n--- [VOE DEBUG START] ---");
        console.log("[1] Requesting Original URL: " + embedUrl);
        
        var res = await fetch(embedUrl, { 
            headers: { 
                "Referer": "https://voe.sx/",
                "User-Agent": DEFAULT_HEADERS['User-Agent']
            } 
        });
        var data = await res.text();

        // 1. Check for the Javascript Redirect (The "Landing Page")
        console.log("[2] Page Length: " + data.length + " chars.");
        var redirectMatch = data.match(/window\.location\.href\s*=\s*['"](https:\/\/[^'"]+)['"]/i);
        
        if (redirectMatch && redirectMatch[1].indexOf('voe.sx') === -1) {
            var jumpUrl = redirectMatch[1];
            console.log("[3] REDIRECT DETECTED! Jumping to: " + jumpUrl);
            
            // Log the "Middleman" HTML to see if it's an ad or a bot check
            var res2 = await fetch(jumpUrl, { headers: { "Referer": embedUrl } });
            console.log("[4] Reached Middleman. Status: " + res2.status);
            data = await res2.text();
            
            // If the middleman is short, it's likely ANOTHER redirect script
            if (data.length < 1500) {
                console.log("[DEBUG-VOE] Middleman HTML is very short. Snippet: " + data.substring(0, 300).replace(/\s+/g, ' '));
                
                // Attempt to find a second jump URL
                var secondJump = data.match(/window\.location\.href\s*=\s*['"](https:\/\/[^'"]+)['"]/i);
                if (secondJump) {
                    console.log("[5] SECOND JUMP DETECTED: " + secondJump[1]);
                    var res3 = await fetch(secondJump[1], { headers: { "Referer": jumpUrl } });
                    data = await res3.text();
                }
            }
        }

        // 2. Log final HTML state before Regex
        console.log("[6] Analyzing Final HTML content...");
        if (data.indexOf('Checking your browser') !== -1 || data.indexOf('cloudflare') !== -1) {
            console.log("!!! ALERT: VOE is blocking you with Cloudflare / Browser Check.");
            return null;
        }

        // 3. Run Parsing Regex
        var rMain = data.match(/json">\s*\[?\s*['"]([^'"]+)['"]\s*\]?\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
        
        if (rMain) {
            console.log("[7] SUCCESS: Found JSON script tag and Payload.");
            var encodedArray = rMain[1];
            var loaderUrl = resolveRelativeUrl(rMain[2], embedUrl);
            
            console.log("[8] Fetching LUT Script: " + loaderUrl);
            var jsRes = await fetch(loaderUrl, { headers: { "Referer": embedUrl } });
            var jsData = await jsRes.text();
            
            var replMatch = jsData.match(/(\[(?:'[^']{1,10}'[\s,]*){4,12}\])/i) || 
                            jsData.match(/(\[(?:"[^"]{1,10}"[,\s]*){4,12}\])/i);
            
            if (replMatch) {
                var decoded = voeDecode(encodedArray, replMatch[1]);
                if (decoded && (decoded.source || decoded.direct_access_url)) {
                    console.log("[9] DECODE COMPLETE: Stream Found.");
                    return decoded.source || decoded.direct_access_url;
                }
            } else {
                console.log("!!! FAILED: Could not find LUT array in the JS loader.");
            }
        } else {
            // Print a snippet of where the video should be
            var bodyIdx = data.indexOf('<body');
            console.log("[10] FAILED: Regex 1 did not match. Body Snippet: " + data.substring(bodyIdx, bodyIdx + 500).replace(/\s+/g, ' '));
        }

        // 4. Final Fallback (Looking for raw .m3u8 or .mp4)
        console.log("[11] Attempting Fallback Regex for raw links...");
        var re = /(?:mp4|hls|file)['"\s]*:\s*['"]([^'"]+)['"]/gi;
        var m;
        while ((m = re.exec(data)) !== null) {
            var url = m[1];
            if (url && url.length > 10) {
                console.log("[12] Fallback found a link!");
                return url.indexOf("aHR0") === 0 ? b64decode(url) : url;
            }
        }

        console.log("--- [VOE DEBUG END - NO STREAM FOUND] ---\n");
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
