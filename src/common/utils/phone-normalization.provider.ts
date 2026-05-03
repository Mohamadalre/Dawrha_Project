

export const normalizeSyrianPhoneNumber = (phone: string): string => {
  if (!phone) return phone;

 
  let cleaned = phone.replace(/\D/g, '');

 
  if (cleaned.startsWith('00963')) {
    cleaned = cleaned.substring(2);
  }
  

  if (cleaned.startsWith('09')) {
    cleaned = '963' + cleaned.substring(1);
  }


  return cleaned;
};