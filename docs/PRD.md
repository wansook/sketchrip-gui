# PRD: SketchRip - Sketchfab 3D Model Extractor

## 1. Background & Motivation

Sketchfab에는 수많은 3D 모델이 업로드되어 있지만, 일부 모델은 다운로드 기능을 비활성화하고 있다.
공식 다운로드 API는 Creator가 다운로드를 허용한 모델만 제공하며, glTF/GLB/USDZ 형식만 지원한다.

**핵심 문제**: 다운로드가 비활성화된 모델도 WebGL 뷰어를 통해 렌더링되고 있으므로,
실제로는 브라우저 메모리에 메쉬·텍스처·머터리얼 데이터가 존재함. 이 데이터를 추출할 도구가 없다.

## 2. Goals

- Sketchfab URL 하나만으로 3D 모델 추출 가능
- 다운로드 비활성화 모델도 WebGL 기반 추출
- glTF / GLB / OBJ 포맷 지원
- 사용자 친화적인 GUI 제공

## 3. Non-Goals

- Sketchfab 외부 모델 소스 지원
- 모델 리메싱 / 리타겟팅 등 편집 기능
- 대량 스크래핑 / 자동 다운로드 봇
- Sketchfab API 인증 관리

## 4. Target Users

- 3D 아티스트 (asset 참고용)
- 개발자 (Three.js 등 렌더링 테스트용)
- 3D 프린팅 준비자
- 일반적인 3D 모델 관심사

## 5. Technical Architecture

### 5.1 Stack

| 레이어 | 기술 |
|--------|------|
| 데스크톱 프레임워크 | Electron |
| UI | HTML/CSS/JS (vanilla) |
| 뷰어 | Chrome Extension (content script) |
| 데이터 추출 | WebGL → BufferGeometry |
| 포맷 변환 | glTF-Transform (glTF/GLB), obj-export (OBJ) |

### 5.2 Flow

```
User 입력 (URL)
  → Extension이 Sketchfab 페이지 inject
  → WebGL context에서 Three.js scene grab
  → BufferGeometry → positions / normals / uv / indices
  → Texture → canvas.toDataURL()
  → Material → PBR params 추출
  → glTF-Transform으로 내보내기
  → 파일 저장 (파일 선택 대화상자)
```

### 5.3 Key Components

#### 5.3.1 Chrome Extension (content script)

Sketchfab 페이지에서 실행되는 스크립트:
- WebGL context hook (getWebGLContexts)
- Three.js scene traversal (scene.children → meshes)
- BufferGeometry 데이터 읽기 (position, normal, uv, index)
- Texture sampling (canvas → base64)
- Material params 추출 (roughness, metalness, color, emissive 등)

#### 5.3.2 Electron Main

- Chrome Extension 생성/관리 (CRX)
- IPC로 추출 데이터 수신
- 파일 저장 대화상자
- UI 렌더링

#### 5.3.3 Format Converter

- glTF/GLB: glTF-Transform 사용
- OBJ: BufferGeometry → OBJ 포맷 직접 변환

## 6. Features

### 6.1 Core Features

| Feature | Description | Priority |
|---------|-------------|----------|
| URL 로드 | Sketchfab URL 입력 후 모델 로드 | P0 |
| WebGL 추출 | 뷰어에서 메쉬/텍스처/머터리얼 추출 | P0 |
| GLB 내보내기 | GLB 파일로 저장 | P0 |
| OBJ 내보내기 | OBJ + MTL 파일로 저장 | P1 |
| glTF 내보내기 | glTF +_BIN + 텍스처로 저장 | P1 |
| 모델 정보 | 메쉬 수, 폴리곤 수, 텍스처 수 표시 | P1 |

### 6.2 Secondary Features

| Feature | Description | Priority |
|---------|-------------|----------|
| 다중 모델 | URL 목록 일괄 처리 | P2 |
| 프리뷰 회전 | 모델 프리뷰 회전/줌 | P2 |
| 로그 | 추출 로그 기록 | P2 |
| 설정 | 출력 경로, 최대 해상도 등 | P2 |

## 7. UI/UX Design

### 7.1 Layout

```
+----------------------------------+
| SketchRip                        | header
+----------------------------------+
| [URL input           ] [로드]    | controls
| [추출] [포맷: GLB ▼]           |
+-------------------+--------------+
|                   |              |
|                   | 추출 정보    |
|   Sketchfab       | 메쉬: -      |
|   Preview         | 텍스처: -    |
|   (webview)       | 폴리곤: -    |
|                   | 버텍스: -    |
|                   | [진행률]     |
+-------------------+--------------+
| SketchRip v0.1.0                    | footer
+----------------------------------+
```

### 7.2 Design System

- **Theme**: 다크 모드 (base: #1a1a2e, accent: #e94560)
- **Font**: system font stack
- **Spacing**: 8px grid
- **Border radius**: 6px

## 8. Technical Constraints

### 8.1 WebGL Limitations

- 텍스처 리샘플링 필요 (원본 해상도 ×4)
- MIPMAP은 lowest level만 추출
-anisotropic filtering 정보는 손실
- Skinned mesh는 bone weights + bind pose 포함

### 8.2 Sketchfab Specifics

- Sketchfab은 자체 WebGL 뷰어 사용 (Three.js fork)
- 모델 데이터는 압축된 binary format (LZ4)
- 텍스처는 WebP/ETC2 등 압축 포맷 사용 가능 → 디코딩 필요
- 애니메이션은 bone animation + keyframe 포함 가능

### 8.3 Security

- Sketchfab의 CORS 정책 우회 필요 (extension 권한 사용)
- Content Security Policy 우회
- Electron의 webviewTag 보안 정책

## 9. Project Structure

```
sketchrip-gui/
├── main.js              # Electron 메인 프로세스
├── preload.js           # IPC 브리지
├── package.json
├── extension/
│   ├── manifest.json    # Chrome extension manifest
│   ├── background.js    # Extension background script
│   ├── content.js       # Sketchfab content script (core logic)
│   └── utils/
│       ├── extractor.js # WebGL → scene data
│       ├── exporter.js  # scene data → glTF/GLB/OBJ
│       └── material.js  # Material 추출/변환
├── renderer/
│   ├── index.html
│   ├── styles.css
│   └── renderer.js
├── docs/
│   └── PRD.md
└── README.md
```

## 10. Implementation Plan

### Phase 1: Core Extraction (v0.1)
- [ ] Extension skeleton + manifest
- [ ] WebGL context hooking
- [ ] BufferGeometry 데이터 추출
- [ ] Electron + Extension IPC 연동
- [ ] GLB 내보내기

### Phase 2: Format Support (v0.2)
- [ ] glTF export
- [ ] OBJ export (+ MTL)
- [ ] Texture sampling (WebP/ETC2 디코딩)
- [ ] Material reconstruction (PBR)

### Phase 3: Polish (v0.3)
- [ ] Animation support
- [ ] Progress reporting
- [ ] Error handling
- [ ] Settings UI
- [ ] Packaging (installer)

## 11. Success Metrics

- 다운로드 비활성화 모델에서 90% 이상 메쉬 추출 성공
- 텍스처 80% 이상 복원 성공
- OBJ 내보내기에서 100% 메쉬/텍스처 복원
- 500MB 이하 모델에서 30초 이내 처리

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Sketchfab 뷰어 업데이트 | Extraction break | Content script version matching |
| Texture compression | Texture corruption | Decode pipeline (WebP → PNG, ETC2 → RGBA) |
| Large models | Memory exhaustion | Chunked extraction, progress |
| Anti-scraping | URL blocked | Rate limiting, user agent rotation |
| Legal | TOS violation | Personal use only, no distribution |

## 13. Timeline

- **Phase 1**: 2주 (core extraction working)
- **Phase 2**: 2주 (format support complete)
- **Phase 3**: 1주 (polish & package)
- **Total**: 약 5주

## 14. Open Questions

1. Sketchfab의 최신 뷰어가 Three.js fork를 여전히 사용하는지
2. WebP/ETC2 디코딩을 Electron에서 어떻게 할지 (node-webp, etc)
3. 애니메이션 데이터를 어떻게 추출/내보낼지
4. OBJ는 머터리얼을 MTL로 분리해야 하는지
5. 설치 패키지 형식 (NSIS, electron-builder, etc)
