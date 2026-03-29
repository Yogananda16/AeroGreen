const axios = require('axios');

const NEWS_API_KEY = process.env.NEWS_API_KEY;

const DANGER_KEYWORDS = [
  "war", "conflict", "missile", "attack", "airspace closed",
  "no fly zone", "military", "bomb", "strike", "invasion",
  "sanctions", "banned", "restricted airspace"
];

async function getRouteNews(countries) {
  try {
    const query = countries.join(' OR ') + ' aviation airspace';
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}&language=en`;

    const response = await axios.get(url);
    const data = response.data;

    if (data.status !== 'ok') return { articles: [], isDangerous: false };

    let isDangerous = false;
    const articles = data.articles.map(article => {
      const title = article.title.toLowerCase();
      const desc = (article.description || '').toLowerCase();

      let dangerous = false;
      for (const keyword of DANGER_KEYWORDS) {
        if (title.includes(keyword) || desc.includes(keyword)) {
          isDangerous = true;
          dangerous = true;
          break;
        }
      }

      return {
        title: article.title,
        source: article.source.name,
        url: article.url,
        published: article.publishedAt?.slice(0, 10),
        isDangerous: dangerous
      };
    });

    return { articles, isDangerous };
  } catch (err) {
    console.error('News API error:', err.message);
    return { articles: [], isDangerous: false };
  }
}

module.exports = { getRouteNews };