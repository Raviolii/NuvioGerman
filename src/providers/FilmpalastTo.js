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

async function fetchStreamPageUrl(searchQuery, season, episode) {
    var searchUrl = new URL('/search/title/' + encodeURIComponent(season ? searchQuery : searchQuery), BASE_URL);
    var response = await fetch(searchUrl.href, { headers: DEFAULT_HEADERS });
    var html = await response.text();
    var $ = cheerio.load(html);

    var streamLinks = $('a[href*="/stream/"]')
        .map(function(_i, el) {
            return {
                href: $(el).attr('href'),
                title: $(el).attr('title') || $(el).text().trim()
            };
        })
        .get();

    if (!streamLinks.length) {
        return undefined;
    }

    if (!season) {
        var yearMatch = streamLinks.find(function(link) {
            return link.title && link.title.includes(String(episode || ''));
        });
        if (yearMatch) {
            return resolveHref(yearMatch.href, BASE_URL);
        }
    }

    var firstLink = streamLinks[0];
    if (!firstLink) {
        return undefined;
    }

    return resolveHref(firstLink.href, BASE_URL);
}

async function getStreams(tmdbId, type, season, episode) {
    if (!tmdbId) {
        return [];
    }

    var searchQuery = season
        ? tmdbId + ' S' + String(season).padStart(2, '0') + 'E' + String(episode || 1).padStart(2, '0')
        : String(tmdbId);

    try {
        var streamPageUrl = await fetchStreamPageUrl(searchQuery, season, episode);
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
