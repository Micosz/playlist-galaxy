# ตรวจ Playlist Galaxy บน Safari และ iPhone

ใช้เพลงเดโมของโปรเจกต์กับ MP3 ทดสอบหนึ่งไฟล์ เช่น สำเนาของ `audio/afterglow.mp3` ชื่อ `Lab - Signal.mp3` ใช้โปรไฟล์ทดสอบปกติสองโปรไฟล์หรืออุปกรณ์ทดสอบสองเครื่อง

1. เปิดพรีวิวใน Safari แตะแว่นขยาย ค้น **Titan** แล้วแตะ **ดูดาว** ตรวจเส้นทางผ่าน Saturn และตรวจว่าหน้ายังเงียบ ใช้ Back กลับแผนที่เดิม
2. เปิด **My Galaxy → Midnight** แตะ **คุมการบิน** แล้วแตะ **Tide** ลองแตะกลางแถบ พัก ยกเลิก แล้วเลือกอีกครั้งจนสุดแถบ เพลง **Blue Hour** ควรเริ่มเมื่อถึงดาว เปิด Ember แล้วกลับมา Tide เพื่อฟังต่อ เมื่อเปิด Reduce Motion ให้ใช้การแตะดาวตามปกติ
3. สร้างดาวทดสอบแล้วเพิ่ม MP3 ผ่านตัวเลือกไฟล์ ค้น **Signal** แล้วแตะ **เล่น** ฟังประมาณห้าวินาที สลับไปดาวที่มีเพลงเดโม แล้วกลับมาเล่น Signal ตรวจตำแหน่งและเสียงจากลำโพงหรือหูฟัง
4. เปิด **จัดการดาว → ย้ายหรือสำรองคลังเพลง → เตรียมไฟล์สำรอง → ดาวน์โหลดไฟล์สำรอง** ตรวจว่าได้ไฟล์ `.pgalaxy` ใน Downloads หรือ Files จริง เปิดอีกโปรไฟล์ เลือกไฟล์ ตรวจจำนวนก่อนกด **รวมเข้ากับคลังนี้** จากนั้นรีโหลด ค้น Signal และลองเล่นต่อจากตำแหน่งที่ส่งออก
5. ลองกับ HTML ใน ZIP ด้วยการแตกไฟล์ก่อน แล้วตัดเครือข่าย หาก Files เปิดได้เพียงตัวอย่างเอกสาร ให้จดว่าเปิดแอปจากไฟล์บนเครื่องนั้นไม่ได้ แยกผลนี้จากการเปิดพรีวิวใน Safari จดรุ่น iOS วิธีเปิดไฟล์ และข้อความข้อผิดพลาดเมื่อรายงาน

## ตรวจซ้ำใน Cloud

```sh
python3 -m playwright install --with-deps webkit firefox
python3 checks/engines.py --browser webkit  --offline-html "/path/to/Playlist Galaxy.html" --exchange-dir /tmp/galaxy-fixtures
python3 checks/engines.py --browser firefox --offline-html "/path/to/Playlist Galaxy.html" --exchange-dir /tmp/galaxy-fixtures
python3 checks/engines.py --browser webkit  --offline-html "/path/to/Playlist Galaxy.html" --exchange-dir /tmp/galaxy-fixtures --from-engine firefox
python3 checks/engines.py --browser firefox --offline-html "/path/to/Playlist Galaxy.html" --exchange-dir /tmp/galaxy-fixtures --from-engine webkit
```

ต้องมี Python Playwright และ FFmpeg ในเครื่องทดสอบ ชุดตรวจใช้เว็บบน localhost และไฟล์ที่แตกจาก ZIP ปิดการร้องขอ HTTP และ HTTPS ก่อนเปิดไฟล์ออฟไลน์ สร้างคลังและ MP3 ขึ้นใหม่ทุกครั้ง และดาวน์โหลดไฟล์จริงมาเทียบข้อมูลเสียงก่อนนำเข้า

รอบนี้ใช้ Playwright WebKit 26.5 บน Linux และ Firefox 153.0 ที่ขนาด 390 × 844 พร้อม touch emulation สำหรับ Firefox บนเครื่อง headless ใช้ PulseAudio null sink แบบมีนาฬิกา การตรวจเสียงวัดเวลาเล่นและจำนวนตัวเล่นเสียงที่กำลังเล่นพร้อมกัน ยังต้องตรวจลำโพง หูฟัง เมนูดาวน์โหลด และตัวเปิดไฟล์ของ iOS บนเครื่องจริง [เอกสารเบราว์เซอร์ของ Playwright](https://playwright.dev/python/docs/browsers)

ในโปรไฟล์ถาวร ทั้งสองเอนจินเก็บ MP3 และย้ายคลังได้ โปรไฟล์ชั่วคราวของ WebKit ในชุดทดสอบนี้รับข้อมูลข้อความ แต่ปฏิเสธ Blob ใน IndexedDB แอปแจ้งให้ใช้หน้าต่างปกติ และคงรายการเดิมไว้ ตรวจกรณีเบราว์เซอร์ปฏิเสธการเล่นหรือดาวน์โหลดแยกจากการเล่นและดาวน์โหลดสำเร็จ
