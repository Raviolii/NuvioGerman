var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://filmpalast.to';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Referer': BASE_URL
};

// ==========================================
// 1. VOE DECODER (Strict ES5)
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
        for (var i = 0; i < s.length; i++) {
            res += String.fromCharCode(s.charCodeAt(i) - n);
        }
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
        } catch (e) {
            return null;
        }
    }
};

// ==========================================
// 2. EXTRACTORS
// ==========================================

async function extractVoe(url) {
    try {
        var response = await fetch(url, { headers: DEFAULT_HEADERS });
        var html = await response.text();
        var matches = html.match(/https?:\/\/[^'"<>]+/g);
        if (!matches) return null;

        var redirectUrl = matches[0];
        var redirectRes = await fetch(redirectUrl, { 
            headers: { 
                'User-Agent': DEFAULT_HEADERS['User-Agent'],
                'Referer': redirectUrl
            } 
        });
        var resHtml = await redirectRes.text();
        
        var $ = cheerio.load(resHtml);
        var scriptTag = $('script[type="application/json"]').first();
        var scriptContent = scriptTag.html();

        if (scriptContent && scriptContent.trim().length > 4) {
            var trimmed = scriptContent.trim();
            var decoded = voeDecoder.decode(trimmed.substring(2, trimmed.length - 2));
            if (decoded && decoded.source) return decoded.source;
        }
    } catch (e) {}
    return null;
}

async function extractVidara(urlStr) {
    try {
        var filecodeMatch = urlStr.match(/\/(?:e|v|f)\/([a-zA-Z0-9]+)/);
        if (!filecodeMatch) return null;
        
        var filecode = filecodeMatch[1];
        var urlParts = urlStr.split('/');
        var apiBase = urlParts[0] + '//' + urlParts[2];

        var response = await fetch(apiBase + '/api/stream', {
            method: 'POST',
            headers: {
                'User-Agent': DEFAULT_HEADERS['User-Agent'],
                'Content-Type': 'application/json',
                'Referer': urlStr,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ filecode: filecode, device: 'web' })
        });
        var data = await response.json();
        return data && data.streaming_url ? data.streaming_url : null;
    } catch (e) {}
    return null;
}

// ==========================================
// 3. MAIN SCRAPER
// ==========================================

async function getStreams(tmdbId, mediaType) {
    var results = [];
    try {
        var type = mediaType || 'movie';
        var tmdbUrl = TMDB_BASE_URL + '/' + (type === 'series' ? 'tv' : 'movie') + '/' + tmdbId + '/external_ids?api_key=' + TMDB_API_KEY;
        
        var idRes = await fetch(tmdbUrl);
        var idData = await idRes.json();
        var imdbId = idData.imdb_id;
        if (!imdbId) return [];

        var searchRes = await fetch(BASE_URL + '/autocomplete.php', {
            method: 'POST',
            headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'term=' + encodeURIComponent(imdbId)
        });
        var movieList = await searchRes.json();
        if (!movieList || movieList.length === 0) return [];

        var targetTitle = movieList[0];
        var searchHtmlRes = await fetch(BASE_URL + '/search/title/' + encodeURIComponent(targetTitle), { headers: DEFAULT_HEADERS });
        var searchHtml = await searchHtmlRes.text();
        var $search = cheerio.load(searchHtml);

        var streamPath = $search('a[href*="filmpalast.to/stream/"]').first().attr('href');
        var finalUrl = streamPath ? (streamPath.indexOf('http') === 0 ? streamPath : BASE_URL + streamPath) : null;

        if (!finalUrl && searchHtml.indexOf('currentStreamLinks') !== -1) {
            finalUrl = BASE_URL + '/search/title/' + encodeURIComponent(targetTitle);
        }
        if (!finalUrl) return [];

        var streamPageRes = await fetch(finalUrl, { headers: DEFAULT_HEADERS });
        var streamPageHtml = await streamPageRes.text();
        var $stream = cheerio.load(streamPageHtml);
        
        var anchors = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();

        for (var i = 0; i < anchors.length; i++) {
            var href = $stream(anchors[i]).attr('href');
            if (!href || href.indexOf('javascript') !== -1) continue;

            var fullUrl = href.indexOf('//') === 0 ? 'https:' + href : (href.indexOf('http') === 0 ? href : 'https://' + href);
            var direct = null;

            if (fullUrl.indexOf('voe.sx') !== -1) {
                direct = await extractVoe(fullUrl);
            } else if (fullUrl.indexOf('vidara.') !== -1) {
                direct = await extractVidara(fullUrl);
            }

            if (direct) {
                results.push({
                    url: direct,
                    meta: { title: direct, countryCodes: ['de'] }
                });
            }
        }
    } catch (e) {}

    return results;
}

module.exports = { getStreams: getStreams };
