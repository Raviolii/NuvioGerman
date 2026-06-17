var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://s.to';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

// 1. Helper to resolve redirects without async
function getFinalRedirect(url, referer) {
    return fetch(url, {
        method: 'GET',
        headers: Object.assign({}, DEFAULT_HEADERS, { 'Referer': referer }),
        redirect: 'follow'
    })
    .then(function(res) { return res.url; })
    .catch(function() { return url; });
}

// 2. Main function using Promise chains
function getStreams(tmdbId, type, season, episode) {
    if (type !== 'series' && type !== 'show' && type !== 'tv') {
        return Promise.resolve([]);
    }

    // Start the chain
    return fetch(TMDB_BASE_URL + '/tv/' + tmdbId + '/external_ids?api_key=' + TMDB_API_KEY)
        .then(function(res) { return res.json(); })
        .then(function(idData) {
            if (!idData.imdb_id) throw new Error("No IMDB ID");
            return fetch(BASE_URL + '/suche?term=' + idData.imdb_id, { headers: DEFAULT_HEADERS });
        })
        .then(function(searchRes) {
            return searchRes.text().then(function(html) {
                var $ = cheerio.load(html);
                var path = $('.col-6.col-md-4.col-lg-2 a.show-cover').attr('href');
                if (!path && html.includes('series-title')) {
                    path = new URL(searchRes.url).pathname;
                }
                return path;
            });
        })
        .then(function(seriesPath) {
            if (!seriesPath) return [];
            var targetUrl = BASE_URL + seriesPath + '/staffel-' + season + '/episode-' + episode;
            
            return fetch(targetUrl, { headers: DEFAULT_HEADERS })
                .then(function(res) { return res.text(); })
                .then(function(epHtml) {
                    var $ep = cheerio.load(epHtml);
                    var linkBoxes = $ep('button.link-box[data-language-id="1"]').toArray();
                    
                    // Map boxes to an array of redirect promises
                    var promises = linkBoxes.map(function(el) {
                        var playPath = $ep(el).attr('data-play-url');
                        var hosterName = $ep(el).attr('data-provider-name') || 'Hoster';
                        if (!playPath) return Promise.resolve(null);

                        return getFinalRedirect(BASE_URL + playPath, targetUrl)
                            .then(function(finalUrl) {
                                if (finalUrl && finalUrl.indexOf('s.to/r/') === -1) {
                                    return {
                                        url: finalUrl,
                                        meta: {
                                            title: hosterName + ' (DE) - S' + season + 'E' + episode,
                                            countryCodes: ['de'],
                                            sourceLabel: "S.to"
                                        }
                                    };
                                }
                                return null;
                            });
                    });

                    return Promise.all(promises);
                });
        })
        .then(function(results) {
            // Filter out the nulls
            return results.filter(function(item) { return item !== null; });
        })
        .catch(function(err) {
            console.log("[S.TO] Error: " + err.message);
            return [];
        });
}

module.exports = { getStreams };