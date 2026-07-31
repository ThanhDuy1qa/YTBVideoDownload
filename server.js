const express = require('express');
const ytSearch = require('yt-search');
const { Readable } = require('stream');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Hàm bổ sung: Tạm dừng server trong x miligiây để chờ file xử lý
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper bóc tách Video ID từ URL YouTube
function getYouTubeVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// ==========================================
// API Xử lý Tìm kiếm từ khóa (yt-search)
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
// API Tải Xuống (Kết nối RapidAPI có cơ chế Chờ)
// ==========================================
app.get('/api/download', async (req, res) => {
  const { url, format, quality } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const videoId = getYouTubeVideoId(url);
  if (!videoId) return res.status(400).send('URL YouTube không hợp lệ');

  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY; 
  if (!RAPIDAPI_KEY) return res.status(500).send('Chưa cấu hình RAPIDAPI_KEY trong Environment Variable');

  // Xác định Endpoint theo tài liệu RapidAPI
  let endpoint = `/get_m4a_download_link/${videoId}`;
  
  if (format === 'mp3') {
    const apiQuality = quality === '320k' ? 'high' : 'low';
    endpoint = `/get_mp3_download_link/${videoId}?quality=${apiQuality}`;
  }

  const targetUrl = `https://youtube-mp3-audio-video-downloader.p.rapidapi.com${endpoint}`;

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'youtube-mp3-audio-video-downloader.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });

    const data = await response.json();

    if (data && data.file) {
      console.log(`Đã lấy link từ RapidAPI. Đang chờ máy chủ của họ chuẩn bị file...`);

      // Vòng lặp kiểm tra ngầm (Polling) tránh lỗi 404
      let isReady = false;
      const maxRetries = 20; // Thử tối đa 20 lần (~1 phút)

      for (let i = 0; i < maxRetries; i++) {
        try {
          const checkRes = await fetch(data.file, { method: 'HEAD' });
          if (checkRes.status === 200) {
            isReady = true;
            break; // File đã sẵn sàng, thoát vòng lặp
          }
        } catch (e) {
          // Bỏ qua lỗi kết nối mạng chập chờn trong lúc chờ
        }

        // Chờ 3 giây rồi kiểm tra lại
        await sleep(3000);
      }

      if (isReady) {
        console.log('✅ File đã sẵn sàng, tiến hành chuyển hướng tải xuống.');
        return res.redirect(data.file);
      } else {
        return res.status(500).send('Video quá dài đang được xử lý. Vui lòng bấm tải lại sau ít phút.');
      }

    } else {
      console.error('RapidAPI Response:', data);
      return res.status(500).send('Không tìm thấy file tải xuống. Vui lòng thử lại sau ít phút.');
    }
  } catch (err) {
    console.error('Lỗi khi kết nối RapidAPI:', err);
    return res.status(500).send(`Lỗi máy chủ: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
});