'use strict';
/**
 * Bước (b) của answerService: chào hỏi, cảm ơn, ngoài phạm vi, nội dung không phù hợp.
 * Trả lời mẫu tức thì, không tốn token. Trả null để chuyển sang bước FAQ.
 */
const { normalizeVi } = require('../utils/textNormalize');

const GREETING = /^(xin chao|chao|hello|hi|alo|hey|chao ban|chao ad|chao admin|chao truong)( (a|ad|admin|ban|em|shop|nhe|oi))*$/;
const THANKS = /^(cam on|thanks|thank you|tks|ok cam on|da cam on|cam on ban|cam on nhieu)( (a|ad|ban|nhe|nhieu))*$/;
const BYE = /^(tam biet|bye|goodbye|hen gap lai)( (a|ad|ban|nhe))*$/;
// Từ thô tục hay gặp (không dấu). Không liệt kê đầy đủ: chỉ để chặn phản hồi LLM với nội dung khiếm nhã.
const ABUSIVE = /\b(dm|dmm|dcm|vcl|vl|cc|dit|lon|cut|ngu vl|oc cho)\b/;
// Câu hỏi rõ ràng ngoài tuyển sinh -> không gọi LLM
const OUT_OF_SCOPE = /\b(thoi tiet|bong da|ty so|xo so|chung khoan|crypto|bitcoin|viet code|lam bai tap|giai toan|cong thuc nau|nau an|tinh yeu|bai hat|phim)\b/;
// Trường dễ bị nhầm (sheet "Cần xác minh" V16)
const CONFUSED_SCHOOL = /\b(cnh|cong nghe ha noi)\b/;

function createRuleAssistant({ configService }) {
  function tryAnswer(message) {
    const n = normalizeVi(message);
    const hotline = configService.get('HOTLINE');
    if (!n) return { answer: 'Bạn hãy nhập câu hỏi về tuyển sinh nhé.', intent: 'EMPTY' };
    if (GREETING.test(n)) return { answer: configService.get('CHAT_GREETING'), intent: 'GREETING' };
    if (THANKS.test(n)) return { answer: 'Rất vui được hỗ trợ bạn! Nếu cần thêm thông tin, bạn cứ hỏi tiếp nhé.', intent: 'THANKS' };
    if (BYE.test(n)) return { answer: 'Chúc bạn chọn được ngành phù hợp. Hẹn gặp lại!', intent: 'BYE' };
    if (ABUSIVE.test(n)) return { answer: 'Kênh này chỉ hỗ trợ các câu hỏi về tuyển sinh. Bạn vui lòng dùng ngôn ngữ phù hợp.', intent: 'ABUSIVE' };
    if (OUT_OF_SCOPE.test(n)) {
      return { answer: `Kênh này chỉ hỗ trợ thông tin tuyển sinh: ngành học, học phí, hồ sơ, lịch xét tuyển… Nội dung khác bạn vui lòng gọi ${hotline}.`, intent: 'OUT_OF_SCOPE' };
    }
    if (CONFUSED_SCHOOL.test(n) && !/cong nghe cao/.test(n)) {
      return {
        answer: 'Lưu ý: Trường Cao đẳng Công nghệ cao Hà Nội (HHT, trường công lập trực thuộc UBND TP Hà Nội) khác với "Cao đẳng Công nghệ Hà Nội" (mã CNH). '
          + 'Kênh này chỉ cung cấp thông tin của HHT. Bạn cần tìm hiểu gì về HHT?',
        intent: 'CONFUSED_SCHOOL',
      };
    }
    return null;
  }
  return { tryAnswer };
}

module.exports = { createRuleAssistant };
