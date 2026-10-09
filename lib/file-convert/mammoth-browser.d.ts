// Bản build trình duyệt của mammoth (UMD, đã gói sẵn phụ thuộc) dùng chung kiểu với gói chính.
declare module 'mammoth/mammoth.browser' {
  import mammoth = require('mammoth');
  export = mammoth;
}
