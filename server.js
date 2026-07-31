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

// API Tải MP3/MP4 với cơ chế Fallback qua nhiều Cobalt Instances
app.get('/api/download', async (req, res) => {
  const { url, format, quality } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const isMp3 = format === 'mp3';
  
  let videoQuality = '720';
  if (quality === '1080p') videoQuality = '1080';
  if (quality === '480p') videoQuality = '480';

  const payload = {
    url: url,
    downloadMode: isMp3 ? 'audio' : 'auto',
    audioFormat: isMp3 ? 'mp3' : 'best',
    videoQuality: videoQuality
  };

  // Danh sách các Public Cobalt Instances mở không yêu cầu JWT/API Key
  const cobaltInstances = [
    'https://co.wuk.sh',
    'https://cobalt-api.kwi.ng',
    'https://cobalt.stream',
    'https://api.cobalt.tools' // Máy chủ gốc (fallback)
  ];

  let downloadUrl = null;
  let lastError = null;

  for (const instanceUrl of cobaltInstances) {
    try {
      console.log(`Đang gửi yêu cầu tới Cobalt Instance: ${instanceUrl}`);

      const response = await fetch(`${instanceUrl}/`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (data && data.url) {
        downloadUrl = data.url;
        console.log(`=> Thành công lấy link từ: ${instanceUrl}`);
        break; // Thoát vòng lặp ngay khi lấy được link tải thành công
      } else {
        lastError = data.text || (data.error && data.error.code) || 'Lỗi từ instance';
        console.warn(`Instance ${instanceUrl} thất bại:`, lastError);
      }
    } catch (err) {
      lastError = err.message;
      console.warn(`Không kết nối được tới instance ${instanceUrl}`);
    }
  }

  if (downloadUrl) {
    return res.redirect(downloadUrl);
  } else {
    return res.status(500).send(`Không thể lấy link tải từ các máy chủ Cobalt. Lỗi cuối: ${lastError}`);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên cổng ${PORT}`);
});