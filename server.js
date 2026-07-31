const express = require('express');
const ytSearch = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public')); // Thư mục chứa index.html
app.use(express.json());

// Helper kiểm tra đường dẫn URL YouTube
function isYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/i.test(url);
}

// API Phân tích Link hoặc Tìm kiếm từ khóa
app.get('/api/parse', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Thiếu thông tin tìm kiếm/URL' });

  try {
    if (isYouTubeUrl(query)) {
      return res.status(400).json({ error: 'Hãy dán link trực tiếp vào khung tải xuống, không cần tìm kiếm.' });
    }

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
    console.error(err);
    res.status(500).json({ error: 'Lỗi hệ thống khi xử lý dữ liệu tìm kiếm.' });
  }
});

// API Tải MP3/MP4 thông qua Cobalt API v10
app.get('/api/download', async (req, res) => {
  const { url, format, quality } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const isMp3 = format === 'mp3';
  
  // Ánh xạ chất lượng theo chuẩn Cobalt v10
  let videoQuality = '720';
  if (quality === '1080p') videoQuality = '1080';
  if (quality === '480p') videoQuality = '480';

  // Body request chuẩn hóa theo Cobalt API v10
  const payload = {
    url: url,
    downloadMode: isMp3 ? 'audio' : 'auto',
    audioFormat: isMp3 ? 'mp3' : 'best',
    videoQuality: videoQuality
  };

  try {
    console.log(`Đang yêu cầu Cobalt v10 xử lý: ${url} | Chế độ: ${payload.downloadMode}`);

    // Endpoint chính của Cobalt API v10
    const response = await fetch('https://api.cobalt.tools/', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data && data.url) {
      // Chuyển hướng trực tiếp tới link file do Cobalt trả về (status: tunnel / redirect)
      return res.redirect(data.url);
    } else {
      console.error('Lỗi từ Cobalt API:', data);
      const errorMsg = data.text || (data.error && data.error.code) || 'Không lấy được link tải.';
      return res.status(500).send(`Lỗi từ máy chủ tải: ${errorMsg}`);
    }
  } catch (error) {
    console.error('Lỗi kết nối Cobalt:', error);
    return res.status(500).send('Lỗi kết nối tới máy chủ Cobalt.');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên cổng ${PORT}`);
});