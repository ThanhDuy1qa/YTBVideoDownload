const express = require('express');
const ytSearch = require('yt-search');
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
// 2. API Tải Xuống Trực Tiếp (Bypass anti-bot 100% trên Cloud)
// ==========================================
app.get('/api/download', async (req, res) => {
  const { url, format } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const videoId = getYouTubeVideoId(url);
  if (!videoId) return res.status(400).send('URL YouTube không hợp lệ');

  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const isMp3 = format === 'mp3';

  try {
    // Bước 1: Gửi yêu cầu phân tích thông tin video
    const analyzeRes = await fetch('https://www.y2mate.com/chats/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams({
        url: targetUrl,
        q_auto: 0,
        ajax: 1
      })
    });

    const analyzeData = await analyzeRes.json();

    if (!analyzeData || analyzeData.status !== 'success' || !analyzeData.links) {
      return res.status(500).send('Máy chủ phân tích bận. Vui lòng thử lại sau vài giây.');
    }

    let downloadKey = '';

    if (isMp3) {
      // Lấy key tải MP3 chất lượng tốt nhất
      const mp3Obj = analyzeData.links.mp3;
      downloadKey = mp3Obj?.auto?.k || Object.values(mp3Obj || {})[0]?.k;
    } else {
      // Lấy key tải MP4 (Ưu tiên 720p, 480p, 360p)
      const mp4Obj = analyzeData.links.mp4;
      downloadKey = mp4Obj?.['22']?.k || mp4Obj?.['18']?.k || Object.values(mp4Obj || {})[0]?.k;
    }

    if (!downloadKey) {
      return res.status(500).send('Không tìm thấy link định dạng phù hợp.');
    }

    // Bước 2: Tiến hành Convert để lấy direct link từ CDN
    const convertRes = await fetch('https://www.y2mate.com/chats/convert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams({
        vid: videoId,
        k: downloadKey
      })
    });

    const convertData = await convertRes.json();

    if (convertData && convertData.c_status === 'CONVERTED' && convertData.dlink) {
      // Chuyển hướng trình duyệt/điện thoại người dùng trực tiếp đến file tải
      return res.redirect(convertData.dlink);
    } else {
      return res.status(500).send('Quá trình tạo link tải thất bại. Vui lòng thử lại.');
    }

  } catch (err) {
    console.error('Lỗi xử lý API:', err);
    return res.status(500).send('Lỗi máy chủ khi lấy link tải.');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
});