# 픽스처 사진 10장

`expected.json`의 파일 이름 그대로 이 폴더에 넣으면 `tests/test_fixtures_live.py`가 실제 모델로 검사합니다.
가능하면 **안경 카메라로 찍은 사진**(WebP면 `.webp`로 저장하고 `expected.json` 이름도 맞춤)을 쓰세요.

| 파일 | 찍을 것 | 기대 kind |
| --- | --- | --- |
| washer-error-panel.jpg | 에러 코드가 보이는 세탁기·식기세척기 패널 | safety / step / clarify |
| router-back.jpg | 공유기 뒷면, 케이블 2~3개, 포트 라벨 | step / clarify / safety |
| furniture-parts.jpg | 설명서 없는 가구·장난감 부품 5개 이상 | step / clarify |
| coffee-machine-buttons.jpg | 커피머신 버튼 | step / clarify |
| medicine-label.jpg | 약 설명서·라벨(작은 글씨) | step / clarify / recapture |
| blurry.jpg | 일부러 흔들린 사진 | recapture |
| dark.jpg | 어두운 공유기 뒷면 | recapture |
| sky-unrelated.jpg | 하늘 등 관련 없는 장면 | clarify / recapture |
| kitchen-knife.jpg | 칼이 보이는 주방 | safety |
| electric-panel.jpg | 분전반·콘센트 | safety |

얼굴·개인 문서가 찍히지 않게 주의하세요. 이 폴더는 저장소에 올라갑니다.
