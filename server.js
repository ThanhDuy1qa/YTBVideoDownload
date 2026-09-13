const express = require('express');
const ytSearch = require('yt-search');
const dns = require('dns');

// Ép Node.js ưu tiên IPv4 để không dính lỗi ENOTFOUND DNS trên Render
dns.setDefaultResultOrder('ipv4first');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Helper bóc tách Video ID từ URL YouTube
function getYouTubeVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Helper đọc JSON an toàn, chống crash khi API trả về trang HTML/Cloudflare
async function safeFetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  
  // Kiểm tra nếu phản hồi là HTML thay vì JSON
  if (text.trim().startsWith('<')) {
    throw new Error('Máy chủ dịch vụ bị Cloudflare chặn (trả về HTML)');
  }
  
  return JSON.parse(text);
}

// ==========================================
// 1. API Tìm kiếm từ khóa (yt-search)
// ==========================================
app.get('/api/parse', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Thiếu thông tin tìm kiếm' });

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const r = await ytSearch(query);
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const videos = r.videos.slice(startIndex, endIndex).map(v => ({
      id: v.videoId,
      url: v.url,
      title: v.title,
      thumbnail: v.thumbnail,
      duration: v.timestamp,
      author: v.author.name
    }));

    res.json({ type: 'search', videos, hasMore: endIndex < r.videos.length });
  } catch (err) {
    console.error('Lỗi search:', err);
    res.status(500).json({ error: 'Lỗi hệ thống khi tìm kiếm dữ liệu.' });
  }
});

// ==========================================
// 2. API Tải Xuống Trực Tiếp (An toàn, chống crash HTML)
// ==========================================
app.get('/api/download', async (req, res) => {
  const { url, format } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const videoId = getYouTubeVideoId(url);
  if (!videoId) return res.status(400).send('URL YouTube không hợp lệ');

  const isMp3 = format === 'mp3';
  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Kênh 1: Phân tích qua Loader Engine Direct
  try {
    const apiUrl = `https://api.vevioz.com/api/button/${isMp3 ? 'mp3' : 'videos'}/${videoId}`;
    const loaderRes = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });

    if (loaderRes.ok) {
      const html = await loaderRes.text();
      const downloadLinkMatch = html.match(/href="(https:\/\/[^"]+)"/);
      if (downloadLinkMatch && downloadLinkMatch[1]) {
        return res.redirect(downloadLinkMatch[1]);
      }
    }
  } catch (e) {
    console.log('Kênh 1 bận, thử chuyển kênh 2...');
  }

  // Kênh 2: Phân tích qua Chuyển đổi API với Bọc kiểm tra JSON
  try {
    const searchData = await safeFetchJson('https://yt1s.com/api/ajaxSearch/index', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams({ q: targetUrl, vt: 'home' })
    });

    if (searchData && searchData.status === 'ok' && searchData.links) {
      const mp3Links = searchData.links.mp3;
      const mp4Links = searchData.links.mp4;
      const key = isMp3 
        ? (mp3Links?.mp3128?.k || Object.values(mp3Links || {})[0]?.k)
        : (mp4Links?.['18']?.k || mp4Links?.['22']?.k || Object.values(mp4Links || {})[0]?.k);

      if (key) {
        const convertData = await safeFetchJson('https://yt1s.com/api/ajaxConvert/convert', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: new URLSearchParams({ vid: videoId, k: key })
        });

        if (convertData && convertData.status === 'ok' && convertData.dlink) {
          return res.redirect(convertData.dlink);
        }
      }
    }
  } catch (e) {
    console.log('Kênh 2 báo lỗi:', e.message);
  }

  return res.status(500).send('Hệ thống đang nghẽn do lượt tải cao trên Server Cloud. Vui lòng bấm thử lại sau 5 giây!');
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
});