var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://filmpalast.to';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Using a modern User-Agent to avoid 'Access Denied'
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

var DEFAULT_HEADERS = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': BASE_URL
};

// ==========================================
// 1. VOE DECODER
// ==========================================
var voeDecoder = {
    shiftLetters: function(input) {
        return input.replace(/[a-zA-Z]/g, function(c) {
            var base = c <= 'Z' ? 65 : 97;
            return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
        });
    },
    replaceJunk: function(input) {
        var junkParts = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
        var result = input;
        for (var i = 0; i < junkParts.length; i++) {
            result = result.split(junkParts[i]).join("_");
        }
        return result.replace(/_/g, "");
    },
    shiftBack: function(s, n) {
        var res = "";
        for (var i = 0; i < s.length; i++) { res += String.fromCharCode(s.charCodeAt(i) - n); }
        return res;
    },
    decode: function(encoded) {
        try {
            var s1 = this.shiftLetters(encoded);
            var s2 = this.replaceJunk(s1);
            var s3 = Buffer.from(s2, 'base64').toString('utf-8');
            var s4 = this.shiftBack(s3, 3);
            var reversed = s4.split('').reverse().join('');
            var s5 = Buffer.from(reversed, 'base64').toString('utf-8');
            return JSON.parse(s5);
        } catch (e) { return null; }
    }
};

// ==========================================
// 2. EXTRACTORS
// ==========================================

async function extractVoe(url) {
    try {
        console.log("[VOE] Fetching landing page: " + url);
        var response = await fetch(url, { headers: DEFAULT_HEADERS });
        var html = await response.text();
        
        // Find redirect link or use original
        var locMatch = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
        var targetUrl = locMatch ? locMatch[1] : url;

        console.log("[VOE] Accessing player page...");
        var playerRes = await fetch(targetUrl, { 
            headers: Object.assign({}, DEFAULT_HEADERS, { 'Referer': url }) 
        });
        var playerHtml = await playerRes.text();

        // Check for "Access Denied" in the HTML preview
        if (playerHtml.includes("File access denied")) {
            console.log("[VOE] ERROR: File access denied (IP Block or Session expired)");
            return null;
        }

        var $ = cheerio.load(playerHtml);
        var scriptContent = $('script[type="application/json"]').first().html();

        if (scriptContent && scriptContent.trim().length > 10) {
            var payload = scriptContent.trim().replace(/^'|'$/g, '');
            var decoded = voeDecoder.decode(payload);
            if (decoded && decoded.source) {
                console.log("[VOE] SUCCESS: Stream found");
                return decoded.source;
            }
        }
        
        // Alternative method for some VOE versions
        var altMatch = playerHtml.match(/sources\s*=\s*JSON\.parse\(atob\(['"]([^'"]+)['"]\)\)/);
        if (altMatch) {
            var decodedAlt = JSON.parse(Buffer.from(altMatch[1], 'base64').toString());
            if (decodedAlt && decodedAlt.hls) return decodedAlt.hls;
        }

        console.log("[VOE] FAILED: No source found in player HTML");
    } catch (e) { console.log("[VOE] EXCEPTION: " + e.message); }
    return null;
}

async function extractVidara(urlStr) {
    try {
        console.log("[Vidara] Fetching: " + urlStr);
        var filecodeMatch = urlStr.match(/\/(?:e|v|f)\/([a-zA-Z0-9]+)/);
        if (!filecodeMatch) return null;

        var apiBase = urlStr.split('/')[0] + '//' + urlStr.split('/')[2];
        var response = await fetch(apiBase + '/api/stream', {
            method: 'POST',
            headers: {
                'User-Agent': UA,
                'Content-Type': 'application/json',
                'Referer': urlStr,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ filecode: filecodeMatch[1], device: 'web' })
        });
        var data = await response.json();
        if (data && data.streaming_url) {
            console.log("[Vidara] SUCCESS: Stream found");
            return data.streaming_url;
        }
    } catch (e) { console.log("[Vidara] EXCEPTION: " + e.message); }
    return null;
}

// ==========================================
// 3. MAIN SCRAPER
// ==========================================

async function getStreams(tmdbId, mediaType) {
    var results = [];
    console.log("[Filmpalast] START: Processing " + tmdbId);

    try {
        var type = mediaType || 'movie';
        var tmdbUrl = TMDB_BASE_URL + '/' + (type === 'series' ? 'tv' : 'movie') + '/' + tmdbId + '/external_ids?api_key=' + TMDB_API_KEY;
        var idData = await fetch(tmdbUrl).then(function(r) { return r.json(); });
        
        if (!idData.imdb_id) {
            console.log("[Filmpalast] No IMDB ID found for TMDB: " + tmdbId);
            return [];
        }

        // Autocomplete
        var searchRes = await fetch(BASE_URL + '/autocomplete.php', {
            method: 'POST',
            headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'term=' + encodeURIComponent(idData.imdb_id)
        });
        
        var movieList = await searchRes.json();
        if (!movieList || movieList.length === 0) {
            console.log("[Filmpalast] No movies found in autocomplete.");
            return [];
        }

        // Filter for non-English results
        var targetTitle = movieList.find(function(t) { return t.toLowerCase().indexOf('english') === -1; }) || movieList[0];
        console.log("[Filmpalast] Target Title: " + targetTitle);

        var searchPageUrl = BASE_URL + '/search/title/' + encodeURIComponent(targetTitle);
        var searchHtml = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS }).then(function(r) { return r.text(); });
        var $search = cheerio.load(searchHtml);
        
        var streamAnchor = $search('a[href*="/stream/"]').first();
        var streamPageUrl = null;

        if (streamAnchor.length > 0) {
            var href = streamAnchor.attr('href');
            // FIX: Clean the path to avoid double domain errors
            var cleanPath = href.replace('/filmpalast.to', '');
            if (cleanPath.indexOf('/') !== 0) cleanPath = '/' + cleanPath;
            streamPageUrl = BASE_URL + cleanPath;
        } else if (searchHtml.includes('currentStreamLinks')) {
            streamPageUrl = searchPageUrl;
        }

        if (!streamPageUrl) {
            console.log("[Filmpalast] ERROR: Could not find stream page.");
            return [];
        }
        console.log("[Filmpalast] Accessing stream page: " + streamPageUrl);

        var streamPageHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(function(r) { return r.text(); });
        var $stream = cheerio.load(streamPageHtml);
        var anchors = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();

        console.log("[Filmpalast] Found " + anchors.length + " hoster links.");

        for (var i = 0; i < anchors.length; i++) {
            var aHref = $stream(anchors[i]).attr('href');
            if (!aHref || aHref.indexOf('javascript') !== -1) continue;
            
            var fullUrl = aHref.indexOf('//') === 0 ? 'https:' + aHref : (aHref.indexOf('http') === 0 ? aHref : 'https://' + aHref);
            var direct = null;
            var label = $stream(anchors[i]).text().trim() || "Stream";

            if (fullUrl.indexOf('voe.sx') !== -1) {
                direct = await extractVoe(fullUrl);
                label = "VOE";
            } else if (fullUrl.indexOf('vidara.') !== -1) {
                direct = await extractVidara(fullUrl);
                label = "Vidara";
            }

            if (direct) {
                results.push({
                    url: direct,
                    meta: { 
                        title: "[" + label + "] Filmpalast", 
                        countryCodes: ['de'] 
                    }
                });
            }
        }
    } catch (e) { console.log("[Filmpalast] FATAL: " + e.message); }

    console.log("[Filmpalast] DONE. Streams found: " + results.length);
    return results;
}

module.exports = { getStreams: getStreams };
