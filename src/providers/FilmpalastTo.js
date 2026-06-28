var cheerio = require('cheerio');

var BASE_URL = 'https://filmpalast.to';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

var STREAMING_HOSTS = [
    'voe', 'dood', 'streamtape', 'veev', 'vinovo', 'vidhide', 'dhtpre',
    'mixdrop', 'supervideo', 'uqload', 'filelion', 'lulustream', 'fastream',
    'dropload', 'savefiles', 'streamembed', 'vidara', 'vidsonic'
];

function isStreamingHost(hostname) {
    return STREAMING_HOSTS.some(function(host) {
        return hostname.includes(host);
    });
}

function resolveHref(href, baseUrl) {
    var fullHref = href.startsWith('//') ? 'https:' + href : href;
    return new URL(fullHref.startsWith('http') ? fullHref : baseUrl + fullHref);
}

function extractAutocompleteResult(candidates) {
    if (Array.isArray(candidates)) {
        for (var i = 0; i < candidates.length; i++) {
            var item = candidates[i];
            if (typeof item === 'string' && item.trim()) {
                return item.trim();
            }
        }
        return undefined;
    }

    if (candidates && typeof candidates === 'object') {
        for (var key in candidates) {
            var value = candidates[key];
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
    }

    return undefined;
}

async function fetchStreamPageUrl(searchQuery, type, season, episode) {
    var autocompleteUrl = BASE_URL + '/autocomplete.php';
    var formData = new URLSearchParams({ term: searchQuery });

    var autocompleteResponse = await fetch(autocompleteUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...DEFAULT_HEADERS
        },
        body: formData.toString()
    });

    var candidates = await autocompleteResponse.json();
    var searchResult = extractAutocompleteResult(candidates);
    if (!searchResult) {
        return undefined;
    }

    if (type === 'series' && season && episode) {
        var seriesSlug = searchResult
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

        if (seriesSlug) {
            return new URL(BASE_URL + '/stream/' + seriesSlug + '-s' + String(season).padStart(2, '0') + 'e' + String(episode).padStart(2, '0'));
        }
    }

    var encodedSearchResult = encodeURIComponent(searchResult);
    var searchPageUrl = BASE_URL + '/search/title/' + encodedSearchResult;
    var searchPageResponse = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS });
    var searchPageHtml = await searchPageResponse.text();
    var $ = cheerio.load(searchPageHtml);

    var streamLink = $('a[href^="//filmpalast.to/stream/"]')
        .first()
        .attr('href');

    if (streamLink) {
        return resolveHref(streamLink, BASE_URL);
    }

    return undefined;
}

async function getStreams(tmdbId, type, season, episode) {
    if (!tmdbId) {
        return [];
    }

    var searchQuery = String(tmdbId);

    try {
        var streamPageUrl = await fetchStreamPageUrl(searchQuery, type, season, episode);
        if (!streamPageUrl) {
            return [];
        }

        var html = await fetch(streamPageUrl.href, { headers: DEFAULT_HEADERS }).then(function(res) {
            return res.text();
        });
        var $ = cheerio.load(html);
        var results = [];

        $('ul.currentStreamLinks').each(function(_i, streamBlock) {
            var hostName = $(streamBlock).find('.hostName').text().trim();
            var title = season ? searchQuery : searchQuery;

            $(streamBlock).find('a[data-player-url]').each(function(_j, el) {
                var playerUrl = $(el).attr('data-player-url');
                if (playerUrl && playerUrl.startsWith('http')) {
                    results.push({
                        url: playerUrl,
                        meta: {
                            countryCodes: ['de'],
                            referer: streamPageUrl.href,
                            title: hostName + ' - ' + title,
                            sourceLabel: 'Filmpalast'
                        }
                    });
                }
            });

            $(streamBlock).find('a[href]').each(function(_j, el) {
                var href = $(el).attr('href');
                if (!href || href === '#' || href.startsWith('javascript') || href.includes('filmpalast.to') || $(el).attr('data-player-url')) {
                    return;
                }

                try {
                    var url = resolveHref(href, BASE_URL);
                    if (isStreamingHost(url.hostname)) {
                        results.push({
                            url: url,
                            meta: {
                                countryCodes: ['de'],
                                referer: streamPageUrl.href,
                                title: hostName + ' - ' + title,
                                sourceLabel: 'Filmpalast'
                            }
                        });
                    }
                } catch (err) {
                    // Invalid URL, skip
                }
            });
        });

        return results;
    } catch (err) {
        return [];
    }
}

module.exports = { getStreams };
