const express = require('express');
const ytSearch = require('yt-search'); // Giữ lại yt-search để xử lý tìm kiếm từ khóa

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Helper kiểm tra đường dẫn URL
function isYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/i.test(url);
}

// API Phân tích Link hoặc Tìm kiếm từ khóa
app.get('/api/parse', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Thiếu thông tin tìm kiếm/URL' });

  try {
    // Dùng yt-search để xử lý từ khóa tìm kiếm
    if (!isYouTubeUrl(query)) {
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

      return res.json({ type: 'search', videos, hasMore: endIndex < r.videos.length });
    } else {
      // Bỏ qua yt-dlp, Frontend sẽ tự xử lý lấy metadata bằng oEmbed cho link trực tiếp
      return res.status(400).json({ error: 'Vui lòng dán trực tiếp link vào ô tìm kiếm.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi hệ thống khi xử lý dữ liệu.' });
  }
});

// API Tải MP3/MP4 (Tích hợp Cobalt API)
app.get('/api/download', async (req, res) => {
  const { url, format, quality } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const isMp3 = format === 'mp3';
  
  // Ánh xạ chất lượng video sang chuẩn của Cobalt
  let vQuality = '720'; 
  if (quality === '1080p') vQuality = '1080';
  if (quality === '480p') vQuality = '480';

  try {
    console.log(`Đang gọi Cobalt API cho: ${url} | Định dạng: ${isMp3 ? 'MP3' : 'MP4'}`);
    
    const response = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: url,
        vQuality: vQuality,
        isAudioOnly: isMp3
      })
    });

    const data = await response.json();

    if (data && data.url) {
      // Chuyển hướng trình duyệt thẳng tới link tải của Cobalt
      return res.redirect(data.url);
    } else {
      console.error('Lỗi từ Cobalt:', data);
      return res.status(500).send('Không thể lấy được link tải lúc này. YouTube có thể đang giới hạn.');
    }
  } catch (err) {
    console.error('Lỗi kết nối Cobalt:', err);
    return res.status(500).send('Đã xảy ra lỗi hệ thống.');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên cổng ${PORT} (Sử dụng Cobalt API)`);
});