# TradeJournal

투자 아이디어 → 관찰 → 매수 계획 → 실제 매매 → 계획 대비 분석 → 회고를 연결하는 개인용 로컬 투자일지입니다. Next.js와 Tauri로 제작되어 웹 개발 환경과 macOS 앱에서 실행할 수 있습니다.

## 주요 기능

- 종목과 투자 아이디어, 목표 가격, 검토일 관리
- 선택형 시장 섹터, 자유로운 내 분류, 다중 태그를 독립적으로 관리
- 대시보드 보유 자산을 내 분류 또는 시장 섹터 기준으로 전환해 비교
- 조건 기반 매수 계획과 실제 매매 기록 연결
- 분할매수·분할매도 이동평균 계산과 포지션 사이클 관리
- 입금 선행 없이 기록하는 매수·매도 중심 원장, 순투입액과 실현손익 계산
- 선택형 계좌·통화별 현재 현금 추적과 입출금·배당·이체 기록
- 과거 매매 수정·삭제 시 전체 원장 자동 재계산
- 관찰 기록 타임라인과 매매 회고
- 계획 매매율, 원칙 준수 점수, 감정별 패턴 분석
- 현재가 기준 평가금액·보유 투자원금·실현/미실현손익 및 계좌별 매매 성과
- 계좌 등록, 현재 현금 입력·수정·추적 중단, 계좌명 변경과 계좌 병합
- 계좌별 수수료율·고정/최소/최대 수수료·금액 구간·적용 기간·반올림 정책 관리와 새 매매 수수료 자동 계산
- 투자 원칙 관리 및 매수 입력 중 위반 가능성 경고
- Twelve Data를 통한 온라인 현재가 갱신과 오프라인 상태 안내
- 저장 대기열, 저장 상태 표시, 실패한 저장 재시도
- 전체 기록 JSON 백업, 선택적 비밀번호 암호화 백업, 안전한 복원 미리보기와 복원 취소
- Mac 앱의 하루 1회 자동 백업(최근 7개 보관)
- 설정의 안전한 매매 원장 전체 soft-delete와 이 Mac에 한정된 최근 1회 되돌리기

## 저장 방식

- Mac 앱에서는 SQLite(`tradejournal.db`)에 기록합니다.
- 주가 API 키는 macOS Keychain에 보관합니다.
- 서버, Supabase, 로그인은 사용하지 않습니다.
- SQLite 파일에는 앱 자체 암호화가 적용되지 않습니다. macOS 사용자 계정과 FileVault로 기기를 보호하세요.
- 브라우저 개발 모드에서는 편의를 위해 localStorage를 사용합니다.
- 새 설치와 비어 있는 저장소는 예시 기록 없이 시작합니다.
- 다른 Mac으로 옮길 때는 설정의 **전체 백업**과 **백업 복원**을 사용합니다.

## Mac 앱 개발 실행

요구 사항: Node.js 22 이상, Rust stable, Xcode Command Line Tools

```bash
pnpm install --frozen-lockfile
pnpm app:dev
```

처음 설치한 Rust가 터미널에서 인식되지 않으면 터미널을 다시 열거나 다음을 실행합니다.

```bash
source "$HOME/.cargo/env"
```

### 개발 앱과 release 앱의 로컬 데이터

개발 실행과 release 빌드는 다음처럼 별도 identity를 사용합니다.

| 용도 | 표시 이름 | Tauri identifier | SQLite / 자동 백업 | Keychain service |
| --- | --- | --- | --- | --- |
| `pnpm app:dev` | `Rationale Dev` | `com.tradejournal.local.dev` | `~/Library/Application Support/com.tradejournal.local.dev/tradejournal.db` / `backups` | `com.tradejournal.local.dev` |
| `pnpm app:build` | `TradeJournal` | `com.tradejournal.local` | `~/Library/Application Support/com.tradejournal.local/tradejournal.db` / `backups` | `com.tradejournal.local` |

`pnpm app:dev`는 기본 release 설정에 `src-tauri/tauri.dev.conf.json`을 병합합니다. SQLite 데이터베이스, 자동 백업과 같은 app-data 파일, 손상 데이터 격리 영역 및 복원 스냅샷, macOS Keychain 항목은 dev/release identifier별로 분리됩니다. 저장소 clone 경로는 이 분리의 기준이 아니며, 여러 clone에서 실행한 개발 앱은 동일한 dev identity를 사용합니다.

개발 앱은 반드시 `pnpm app:dev`로 실행하세요. `pnpm tauri dev`를 직접 호출하면 dev override를 우회하고 기본 release 설정을 사용합니다. 서로 다른 앱 이름과 identifier 덕분에 `Rationale Dev`와 설치된 `TradeJournal`은 같은 Mac에 함께 둘 수 있습니다.

기존 `com.tradejournal.local` 데이터와 Keychain 항목은 이동, 복사, 삭제 또는 변경하지 않습니다. 기존 설치 앱과 `pnpm app:build` 결과물은 계속 같은 release identity로 기존 데이터에 접근합니다. 최종 Rationale production identifier를 정하고 기존 데이터를 이전하는 작업은 별도의 후속 설계와 검증이 필요합니다.

Mac 앱의 자동 백업과 수동 내보내기는 백업 대상 16개 컬렉션을 하나의 SQLite 읽기 트랜잭션과 동일 connection에서 읽습니다. 따라서 백업 도중 같은 개수의 update나 관계 레코드 변경이 발생해도 서로 다른 시점의 값이 한 파일에 섞이지 않습니다. 트랜잭션은 raw 행을 메모리에 담은 직후 종료되며, 마이그레이션·검증·직렬화·파일 기록은 그 뒤에 수행됩니다. 이 보장은 임시 WAL SQLite의 두 connection과 명시적 동기화 지점을 사용하는 반복 동시성 테스트로 검증하며, 실제 사용자 데이터는 테스트에 사용하지 않습니다.

## 설치용 Mac 앱 빌드

```bash
pnpm app:build
```

결과물은 다음 위치에 생성됩니다.

```text
src-tauri/target/release/bundle/macos/TradeJournal.app
src-tauri/target/release/bundle/dmg/*.dmg
```

개인 개발 서명 없이 만든 앱은 다른 Mac에서 Gatekeeper 경고가 표시될 수 있습니다.

## 브라우저 미리보기

```bash
pnpm dev
```

브라우저 미리보기 데이터와 Mac 앱의 SQLite 데이터는 서로 다른 저장소입니다. 실제 기록은 Mac 앱에서 입력하는 것을 권장합니다.

## 품질 검사

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

GitHub Actions CI는 `main` push와 pull request에서 고정된 pnpm 의존성으로 프런트엔드 검사·빌드·E2E 테스트를 실행하고, macOS에서 Rust 포맷·컴파일·테스트를 확인합니다.

## 백업

설정 → 데이터 백업에서 일반 JSON 또는 비밀번호로 보호한 `.rationale-backup` 파일을 저장할 수 있습니다. 암호화 백업은 Mac 앱에서만 지원하며, 비밀번호를 잊으면 복구할 수 없습니다. 두 형식 모두 복원 전 파일 날짜와 항목 수를 미리 보여주며, 복원 직전의 현재 데이터도 안전 사본으로 남겨 설정에서 한 번에 되돌릴 수 있습니다.

일반 JSON과 자동 백업에는 거래 내역, 계좌명, 투자 메모와 감정 기록이 평문으로 포함될 수 있습니다. 이메일·메신저·공유 폴더에 올릴 때 주의하고, 계좌번호·비밀번호·인증정보는 메모에 기록하지 마세요. Mac 앱은 하루에 한 번 앱 데이터 폴더에 암호화되지 않은 자동 백업을 만들고 최근 7개를 보관합니다. 자동 백업의 최근 실행 시각과 위치는 설정에서 확인할 수 있습니다. 외부 저장소에는 수동 암호화 백업을 보관하는 것을 권장합니다. SQLite 파일 자체를 두 Mac에서 동시에 iCloud 동기화하는 방식은 충돌 위험이 있어 지원하지 않습니다.

투자 기록은 서버로 업로드되지 않지만, 실행 중인 앱과 macOS 사용자 계정은 평문 데이터에 접근할 수 있습니다. 공용 Mac 또는 여러 사람이 공유하는 계정에서는 사용에 주의하고 FileVault를 활성화하세요.

## 현재 제한사항

- 집/회사 Mac 사이 자동 동기화는 하지 않습니다.
- Twelve Data 무료 요금제의 호출 한도가 적용됩니다.
- 현재 포트폴리오의 USD 환산값은 대시보드에서 참고용 환율을 사용합니다.
- 로그인과 서버 저장 없이 동작하므로 Mac 사이 이동은 백업/복원을 사용해야 합니다.
- 수수료 자동 계산은 새 매수·매도에만 적용되며, 기존 거래와 파일에서 제공된 수수료를 자동으로 덮어쓰지 않습니다. 세금은 계속 직접 입력합니다.

수수료 규칙의 매칭·반올림 계약은 [`docs/account-fee-policy-v1.md`](docs/account-fee-policy-v1.md), 매매 입력·출처·호환성 계약은 [`docs/trade-fee-automation-v1.md`](docs/trade-fee-automation-v1.md)를 참고하세요.

매매 원장 초기화의 보존 범위, tombstone, 로컬 되돌리기 계약은 [`docs/trade-ledger-reset-v1.md`](docs/trade-ledger-reset-v1.md)를 참고하세요.
