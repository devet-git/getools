# Đồng bộ Google Drive — hướng dẫn cài đặt

Tính năng nằm ở **Cài đặt → Dữ liệu → Đồng bộ Google Drive**. Nó lưu cài đặt, snippets, dấu trang, lịch sử, checklist,
bản nháp… vào Google Drive của **chính người dùng** và đồng bộ giữa các máy / trình duyệt.

## Cách hoạt động (tóm tắt)

- Đăng nhập bằng **Google Identity Services** ngay trên trình duyệt (popup). Máy chủ GeTools không nhận, không lưu token
  hay dữ liệu của người dùng; máy chủ chỉ trả về Client ID qua `GET /api/drive/config`.
- Quyền xin là `https://www.googleapis.com/auth/drive.appdata` (**non-sensitive**): ứng dụng chỉ đọc/ghi một thư mục ẩn
  dành riêng cho nó (`appDataFolder`), **không** thấy bất kỳ file nào khác trong Drive. Dữ liệu là một file
  `getools-sync.json` (cùng định dạng với tệp sao lưu).
- Đồng bộ 3 chiều: mỗi máy nhớ dấu vân tay của lần đồng bộ trước, nên sửa/xóa ở máy nào sẽ lan sang máy kia; nếu hai máy
  cùng sửa một mục thì gộp (snippet theo id, lịch sử loại trùng…). Có nút "Hoàn tác lần đồng bộ".
- Khóa API / token Git **mặc định không** được đồng bộ (có tùy chọn bật riêng).

## Cài đặt (làm một lần, ~10 phút)

### 1. Tạo dự án và bật Google Drive API

1. Vào [Google Cloud Console](https://console.cloud.google.com/) → chọn hoặc **tạo dự án mới** (vd. `getools`).
2. **APIs & Services → Library** → tìm **Google Drive API** → **Enable**.

### 2. Cấu hình màn hình đồng ý OAuth

Vào **Google Auth Platform** (tên cũ: *APIs & Services → OAuth consent screen*):

1. **Branding**: tên ứng dụng (vd. `GeTools`), email hỗ trợ, email liên hệ của nhà phát triển. Nếu đã có tên miền, thêm vào
   **Authorized domains** (vd. `getools.example.com` → nhập `example.com`).
2. **Audience**: User type = **External**.
   - Đang thử nghiệm: để **Testing** và thêm email của bạn vào **Test users** (tối đa 100 người).
   - Dùng công khai: bấm **Publish app**. Vì chỉ dùng scope non-sensitive nên **không** cần thẩm định bảo mật; muốn hiện
     tên + logo trên màn hình đăng nhập thì Google có thể yêu cầu xác minh thương hiệu (trang chủ, chính sách quyền riêng tư).
3. **Data access → Add or remove scopes** → thêm `.../auth/drive.appdata`
   (mô tả: *See, create, and delete its own configuration data in your Google Drive*) → **Save**.

### 3. Tạo OAuth Client ID

1. **Google Auth Platform → Clients** (hoặc *APIs & Services → Credentials*) → **Create client**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins** — thêm mọi địa chỉ chạy app (chỉ scheme + host + port, không có đường dẫn, không có `/` cuối):
   - `http://localhost:3000` (chạy dev)
   - `https://ten-mien-cua-ban.com` (bản triển khai; vd. URL Cloud Run `https://getools-xxxx.a.run.app`)
4. **Authorized redirect URIs**: để trống (luồng popup không dùng redirect).
5. **Create** → sao chép **Client ID** dạng `1234567890-abc….apps.googleusercontent.com`.
   Client secret **không** cần dùng.

> Thêm/sửa origin có thể mất vài phút mới có hiệu lực.

### 4. Khai báo biến môi trường

Client ID không phải bí mật, nhưng vẫn để ở biến môi trường để mỗi nơi triển khai dùng một client riêng.
Biến được đọc **lúc chạy** — đổi giá trị chỉ cần khởi động lại, không cần build lại.

**Chạy local** — tạo `.env.local` ở thư mục gốc:

```bash
GOOGLE_CLIENT_ID="1234567890-abc....apps.googleusercontent.com"
```

```bash
npm run dev        # rồi mở http://localhost:3000
```

**Production (Node / Docker)**: đặt biến môi trường cho tiến trình server rồi khởi động như bình thường, vd.

```bash
npm run build
GOOGLE_CLIENT_ID="1234567890-abc....apps.googleusercontent.com" npm start
```

**Vercel**:

1. **Project → Settings → Environment Variables** → thêm `GOOGLE_CLIENT_ID` (dán giá trị **không** kèm dấu ngoặc kép),
   tích đúng môi trường cần dùng: **Production** (domain chính) và/hoặc **Preview** (các URL `*.vercel.app` của từng nhánh).
2. **Deployments → bản mới nhất → ⋯ → Redeploy**. Vercel chỉ gắn biến môi trường vào deployment tạo **sau** khi thêm biến —
   deployment cũ không bao giờ thấy biến mới.
3. Thêm domain Vercel vào **Authorized JavaScript origins** của Client ID (vd. `https://getools.vercel.app`). URL preview
   mỗi nhánh có domain riêng, cần thêm riêng nếu muốn dùng ở đó.

**Cloud Run**:

```bash
gcloud run services update <ten-service> --region <region> \
  --update-env-vars GOOGLE_CLIENT_ID=1234567890-abc....apps.googleusercontent.com
```

(Trên Google AI Studio: thêm biến `GOOGLE_CLIENT_ID` trong mục Secrets / biến môi trường của app.)

Kiểm tra nhanh: mở `https://<địa-chỉ-app>/api/drive/config` phải thấy `{"clientId":"…apps.googleusercontent.com"}`.

### 5. Sử dụng

1. Mở app → **Cài đặt** (biểu tượng bánh răng) → tab **Dữ liệu** → **Kết nối Google Drive**.
2. Chọn tài khoản Google, **tích ô cho phép** truy cập dữ liệu cấu hình của ứng dụng → lần đồng bộ đầu tiên chạy ngay.
3. Lặp lại trên máy / trình duyệt khác với **cùng tài khoản Google** → dữ liệu hai bên được gộp.
4. Sau đó:
   - **Tự động đồng bộ** (bật sẵn): đẩy lên ~8 giây sau khi dữ liệu đổi; kéo bản mới khi quay lại tab (tối đa 2 phút/lần).
   - **Đồng bộ ngay**: chạy tay bất cứ lúc nào.
   - **Tùy chọn nâng cao**: *Ghi đè Drive bằng máy này* / *Thay máy này bằng bản Drive* (khi muốn một bên thắng hoàn toàn),
     *Xóa dữ liệu trên Drive*, *Ngắt kết nối* (thu hồi quyền).

## Giới hạn cần biết

- Phiên đăng nhập Google của luồng trình duyệt chỉ sống **~1 giờ** và không có refresh token. Hết hạn thì tự động đồng bộ
  tạm dừng, thẻ hiện **"Cần kết nối lại"** — bấm **Kết nối lại & đồng bộ** (thường chỉ chớp popup, không phải nhập lại mật khẩu).
  App cố ý không tự mở popup để tránh làm phiền.
- Chỉ đồng bộ khi app đang mở (không có tiến trình chạy nền trên máy chủ).
- Dữ liệu sau khi được kéo về, trang công cụ đang mở có thể cần tải lại để hiện bản mới.
- Kích thước tối đa 10 MB (như tệp sao lưu).

## Xử lý sự cố

| Hiện tượng | Nguyên nhân / cách sửa |
|---|---|
| Thẻ báo "Máy chủ chưa bật tính năng này" | `/api/drive/config` trả `{"clientId":null}`: chưa đặt `GOOGLE_CLIENT_ID`, chưa khởi động lại / **Redeploy** (Vercel) sau khi đặt, hoặc biến không bật cho môi trường đang mở (Production ≠ Preview). |
| Thẻ báo "Không đọc được cấu hình Google Drive…" | Bản đang chạy chưa có route `/api/drive/config` (deploy cũ) hoặc route lỗi — deploy lại bản mới nhất, xem log của server/Vercel Functions. |
| Popup Google báo `Error 400: origin_mismatch` / `redirect_uri_mismatch` | Địa chỉ đang mở app chưa có trong **Authorized JavaScript origins** (chú ý `http` ≠ `https`, `localhost` ≠ `127.0.0.1`, cổng). Thêm rồi đợi vài phút. |
| `Error 403: access_denied` — app chưa được Google xác minh | App đang ở chế độ **Testing**: thêm email vào **Test users**, hoặc **Publish app**. |
| "Trình duyệt chặn cửa sổ đăng nhập" | Cho phép popup với trang này rồi bấm lại. |
| "Bạn chưa tích quyền…" | Ở màn hình đồng ý của Google phải tích ô quyền Drive. Bấm kết nối lại. |
| "Google Drive API chưa được bật…" | Làm lại bước 1.2 trong **đúng dự án** chứa Client ID. |
| Không thấy file trong Google Drive | Bình thường: file nằm trong thư mục ẩn của app. Xem/xóa tại drive.google.com → ⚙ **Settings → Manage apps → GeTools → Options → Delete hidden app data**. |

Thu hồi quyền của GeTools bất cứ lúc nào tại [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Mã nguồn liên quan

| File | Vai trò |
|---|---|
| `app/api/drive/config/route.ts` | Trả Client ID từ biến môi trường |
| `lib/google-drive.ts` | Nạp Google Identity Services, lấy token, gọi Drive REST API (appDataFolder) |
| `lib/drive-sync.ts` | Logic đồng bộ 3 chiều thuần (không gọi mạng) |
| `lib/drive-sync-client.ts` | Trạng thái, tự động đồng bộ, kết nối / ngắt kết nối |
| `components/DriveSyncSection.tsx` | Giao diện trong Cài đặt → Dữ liệu |
| `lib/backup.ts` | Danh sách khóa được sao lưu/đồng bộ (`BACKUP_KEYS`) — thêm dữ liệu mới vào đây để nó được đồng bộ |
