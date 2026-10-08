/**
 * Dữ liệu cheat sheet lệnh Git (tiếng Việt) + hàm điền placeholder an toàn cho shell.
 * Logic thuần, không phụ thuộc React.
 */

export type DangerLevel = 'safe' | 'caution' | 'danger';

export interface CheatEntry {
  id: string;
  group: string;
  /** Tình huống: "Tôi muốn..." */
  want: string;
  commands: string[];
  explain: string;
  danger?: DangerLevel;
  /** Giải thích vì sao nguy hiểm (hiện khi danger != safe). */
  warning?: string;
}

export interface CheatGroup {
  id: string;
  title: string;
}

export const CHEAT_GROUPS: CheatGroup[] = [
  { id: 'init', title: 'Khởi tạo & cấu hình' },
  { id: 'commit', title: 'Thay đổi & commit' },
  { id: 'undo', title: 'Hoàn tác' },
  { id: 'branch', title: 'Nhánh' },
  { id: 'integrate', title: 'Merge / Rebase / Cherry-pick / Stash' },
  { id: 'remote', title: 'Remote, push & pull' },
  { id: 'tag', title: 'Tag' },
  { id: 'history', title: 'Xem lịch sử' },
  { id: 'cleanup', title: 'Dọn dẹp' },
  { id: 'submodule', title: 'Submodule' },
  { id: 'worktree', title: 'Worktree' },
];

export interface PlaceholderDef {
  key: string;
  label: string;
  example: string;
}

/** Các placeholder có thể điền trong form. */
export const PLACEHOLDERS: PlaceholderDef[] = [
  { key: 'branch', label: 'Nhánh', example: 'feature/login' },
  { key: 'newbranch', label: 'Tên nhánh mới', example: 'feature/new' },
  { key: 'remote', label: 'Remote', example: 'origin' },
  { key: 'message', label: 'Nội dung commit / ghi chú', example: 'Sửa lỗi đăng nhập' },
  { key: 'file', label: 'File', example: 'src/app.ts' },
  { key: 'path', label: 'Đường dẫn', example: 'libs/foo' },
  { key: 'commit', label: 'Commit (hash)', example: 'a1b2c3d' },
  { key: 'tag', label: 'Tag', example: 'v1.0.0' },
  { key: 'url', label: 'URL repo', example: 'https://github.com/user/repo.git' },
  { key: 'name', label: 'Tên', example: 'Nguyen Van A' },
  { key: 'email', label: 'Email', example: 'a@example.com' },
  { key: 'n', label: 'Số (n)', example: '3' },
];

const PH_KEYS = new Set(PLACEHOLDERS.map((p) => p.key));

/** Bọc chuỗi bằng nháy đơn nếu cần, an toàn cho bash/zsh/sh. */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Thay <key> bằng giá trị đã nhập (đã quote). Giá trị rỗng thì giữ nguyên placeholder. */
export function fillCommand(cmd: string, values: Record<string, string>): string {
  return cmd.replace(/<([a-z0-9]+)>/g, (m, key: string) => {
    if (!PH_KEYS.has(key)) return m;
    const v = (values[key] ?? '').replace(/[\r\n]+/g, ' ').trim();
    return v ? shellQuote(v) : m;
  });
}

export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

export function entryMatches(e: CheatEntry, q: string): boolean {
  const n = normalizeText(q.trim());
  if (!n) return true;
  const hay = normalizeText([e.want, e.explain, e.warning ?? '', ...e.commands].join(' \n '));
  return n.split(/\s+/).every((w) => hay.includes(w));
}

export const CHEAT_ENTRIES: CheatEntry[] = [
  // ---------- Khởi tạo & cấu hình ----------
  {
    id: 'init-repo',
    group: 'init',
    want: 'Tôi muốn tạo repo Git mới trong thư mục hiện tại',
    commands: ['git init', 'git init -b main'],
    explain: 'Tạo thư mục .git. Tùy chọn -b đặt tên nhánh đầu tiên (ví dụ main).',
  },
  {
    id: 'clone',
    group: 'init',
    want: 'Tôi muốn tải (clone) một repo về máy',
    commands: ['git clone <url>', 'git clone --depth 1 <url>', 'git clone -b <branch> <url>'],
    explain: 'Dạng thứ hai chỉ lấy commit mới nhất (shallow, nhanh hơn). Dạng thứ ba clone thẳng một nhánh cụ thể.',
  },
  {
    id: 'config-user',
    group: 'init',
    want: 'Tôi muốn đặt tên và email cho commit',
    commands: ['git config --global user.name <name>', 'git config --global user.email <email>'],
    explain: 'Bỏ --global để chỉ áp dụng cho repo hiện tại.',
  },
  {
    id: 'config-list',
    group: 'init',
    want: 'Tôi muốn xem cấu hình Git đang dùng và nguồn của nó',
    commands: ['git config --list --show-origin', 'git config user.email'],
    explain: 'Hiện tất cả cấu hình kèm file định nghĩa. Lệnh thứ hai chỉ xem một khóa.',
  },
  {
    id: 'config-alias',
    group: 'init',
    want: 'Tôi muốn tạo lệnh tắt (alias)',
    commands: ["git config --global alias.st status", "git config --global alias.lg \"log --oneline --graph --decorate --all\""],
    explain: 'Sau đó gõ git st hoặc git lg.',
  },
  {
    id: 'config-editor',
    group: 'init',
    want: 'Tôi muốn đổi nhánh mặc định và cách pull cho mọi repo mới',
    commands: ['git config --global init.defaultBranch main', 'git config --global pull.rebase false'],
    explain: 'Đặt main làm nhánh mặc định khi git init, và pull theo kiểu merge (đặt true để rebase).',
  },

  // ---------- Thay đổi & commit ----------
  {
    id: 'status',
    group: 'commit',
    want: 'Tôi muốn xem tình trạng thay đổi hiện tại',
    commands: ['git status', 'git status -sb'],
    explain: '-sb cho kết quả ngắn gọn kèm tên nhánh.',
  },
  {
    id: 'add',
    group: 'commit',
    want: 'Tôi muốn đưa thay đổi vào vùng staging',
    commands: ['git add <file>', 'git add .', 'git add -p'],
    explain: 'add . thêm mọi thay đổi trong thư mục hiện tại. add -p cho chọn từng đoạn (hunk) để stage.',
  },
  {
    id: 'commit',
    group: 'commit',
    want: 'Tôi muốn commit những gì đã stage',
    commands: ['git commit -m <message>', 'git commit -am <message>'],
    explain: '-a tự stage các file đã được theo dõi (không gồm file mới) trước khi commit.',
  },
  {
    id: 'amend-message',
    group: 'commit',
    want: 'Tôi muốn sửa nội dung commit cuối cùng (hoặc thêm file bị quên)',
    commands: ['git commit --amend -m <message>', 'git add <file> && git commit --amend --no-edit'],
    explain: 'Thay thế commit cuối bằng commit mới. Nếu commit đã push, bạn phải force push sau đó.',
    danger: 'caution',
    warning: 'Viết lại lịch sử: chỉ làm khi commit chưa push hoặc chỉ mình bạn dùng nhánh.',
  },
  {
    id: 'diff-staged',
    group: 'commit',
    want: 'Tôi muốn xem mình đã thay đổi gì trước khi commit',
    commands: ['git diff', 'git diff --staged', 'git diff --stat'],
    explain: 'diff: chưa stage. --staged: đã stage. --stat: chỉ thống kê số dòng theo file.',
  },
  {
    id: 'mv-rm',
    group: 'commit',
    want: 'Tôi muốn đổi tên hoặc xóa file và để Git theo dõi',
    commands: ['git mv <file> <path>', 'git rm <file>', 'git rm --cached <file>'],
    explain: 'rm --cached chỉ bỏ file khỏi Git nhưng giữ lại trên đĩa (hữu ích khi thêm vào .gitignore).',
  },

  // ---------- Hoàn tác ----------
  {
    id: 'undo-soft',
    group: 'undo',
    want: 'Tôi muốn hủy commit cuối nhưng giữ lại thay đổi (đã stage)',
    commands: ['git reset --soft HEAD~1'],
    explain: 'Đưa HEAD lùi một commit, các thay đổi vẫn nằm trong staging để commit lại.',
    danger: 'caution',
    warning: 'Viết lại lịch sử cục bộ. Đừng làm với commit đã push lên nhánh dùng chung.',
  },
  {
    id: 'undo-mixed',
    group: 'undo',
    want: 'Tôi muốn hủy commit cuối, giữ thay đổi nhưng bỏ stage',
    commands: ['git reset HEAD~1', 'git reset HEAD~<n>'],
    explain: 'Mặc định là --mixed: file vẫn còn nguyên trên đĩa, chỉ không còn trong commit hay staging.',
    danger: 'caution',
    warning: 'Viết lại lịch sử cục bộ.',
  },
  {
    id: 'undo-hard',
    group: 'undo',
    want: 'Tôi muốn vứt bỏ hoàn toàn commit cuối và mọi thay đổi',
    commands: ['git reset --hard HEAD~1', 'git reset --hard <commit>'],
    explain: 'Đưa nhánh và thư mục làm việc về đúng trạng thái commit chỉ định.',
    danger: 'danger',
    warning: 'MẤT thay đổi chưa commit vĩnh viễn. Commit bị bỏ chỉ cứu được qua git reflog.',
  },
  {
    id: 'discard-file',
    group: 'undo',
    want: 'Tôi muốn bỏ thay đổi chưa stage của một file',
    commands: ['git restore <file>', 'git checkout -- <file>'],
    explain: 'Đưa file về trạng thái ở lần commit/stage gần nhất. Lệnh checkout là cách cũ.',
    danger: 'danger',
    warning: 'Thay đổi chưa commit của file đó sẽ mất, không khôi phục được.',
  },
  {
    id: 'discard-all',
    group: 'undo',
    want: 'Tôi muốn bỏ toàn bộ thay đổi chưa commit',
    commands: ['git restore .', 'git reset --hard'],
    explain: 'Đưa toàn bộ file đã theo dõi về trạng thái HEAD. File mới (untracked) không bị đụng tới.',
    danger: 'danger',
    warning: 'Mất toàn bộ thay đổi chưa commit, không khôi phục được.',
  },
  {
    id: 'unstage',
    group: 'undo',
    want: 'Tôi muốn bỏ file khỏi vùng staging (giữ nguyên nội dung)',
    commands: ['git restore --staged <file>', 'git reset HEAD <file>'],
    explain: 'File quay lại trạng thái "đã sửa nhưng chưa stage".',
  },
  {
    id: 'restore-from',
    group: 'undo',
    want: 'Tôi muốn lấy lại một file từ commit hoặc nhánh khác',
    commands: ['git restore --source=<commit> <file>', 'git checkout <branch> -- <file>'],
    explain: 'Ghi đè file hiện tại bằng phiên bản ở commit/nhánh chỉ định.',
    danger: 'caution',
    warning: 'Ghi đè nội dung file hiện tại.',
  },
  {
    id: 'revert',
    group: 'undo',
    want: 'Tôi muốn hoàn tác một commit đã push (an toàn cho nhánh chung)',
    commands: ['git revert <commit>', 'git revert -m 1 <commit>'],
    explain: 'Tạo commit mới đảo ngược thay đổi, không viết lại lịch sử. Dùng -m 1 khi revert một merge commit.',
  },
  {
    id: 'reflog',
    group: 'undo',
    want: 'Tôi muốn cứu lại commit/nhánh lỡ xóa hoặc reset nhầm',
    commands: ['git reflog', 'git reset --hard HEAD@{1}', 'git branch <newbranch> <commit>'],
    explain: 'reflog liệt kê các vị trí HEAD trước đây (thường giữ khoảng 90 ngày). Tìm hash cần lấy lại rồi tạo nhánh mới trỏ vào đó (cách an toàn nhất).',
    danger: 'caution',
    warning: 'Lệnh reset --hard trong ví dụ sẽ ghi đè thư mục làm việc; ưu tiên tạo nhánh mới từ hash.',
  },
  {
    id: 'abort',
    group: 'undo',
    want: 'Tôi muốn hủy một merge / rebase / cherry-pick đang dở',
    commands: ['git merge --abort', 'git rebase --abort', 'git cherry-pick --abort'],
    explain: 'Đưa repo về trạng thái trước khi bắt đầu thao tác.',
  },

  // ---------- Nhánh ----------
  {
    id: 'branch-list',
    group: 'branch',
    want: 'Tôi muốn xem danh sách nhánh',
    commands: ['git branch', 'git branch -a', 'git branch -vv'],
    explain: '-a gồm cả nhánh remote. -vv hiện nhánh upstream và commit cuối.',
  },
  {
    id: 'branch-create',
    group: 'branch',
    want: 'Tôi muốn tạo nhánh mới và chuyển sang đó',
    commands: ['git switch -c <newbranch>', 'git checkout -b <newbranch>', 'git switch -c <newbranch> <commit>'],
    explain: 'Dạng thứ ba tạo nhánh từ một commit/nhánh cụ thể thay vì HEAD.',
  },
  {
    id: 'branch-switch',
    group: 'branch',
    want: 'Tôi muốn chuyển sang nhánh khác',
    commands: ['git switch <branch>', 'git switch -', 'git checkout <branch>'],
    explain: 'switch - quay lại nhánh vừa ở trước đó.',
  },
  {
    id: 'branch-rename',
    group: 'branch',
    want: 'Tôi muốn đổi tên nhánh hiện tại',
    commands: ['git branch -m <newbranch>', 'git branch -m <branch> <newbranch>'],
    explain: 'Nếu nhánh cũ đã push, cần xóa nhánh cũ trên remote và push nhánh mới (--set-upstream).',
  },
  {
    id: 'branch-delete-local',
    group: 'branch',
    want: 'Tôi muốn xóa nhánh cục bộ',
    commands: ['git branch -d <branch>', 'git branch -D <branch>'],
    explain: '-d chỉ xóa khi đã merge. -D xóa bắt buộc.',
    danger: 'caution',
    warning: '-D bỏ qua kiểm tra merge; commit chưa merge chỉ cứu lại được qua reflog.',
  },
  {
    id: 'branch-delete-remote',
    group: 'branch',
    want: 'Tôi muốn xóa nhánh trên remote',
    commands: ['git push <remote> --delete <branch>', 'git fetch <remote> --prune'],
    explain: 'Lệnh sau dọn các tham chiếu nhánh remote đã bị xóa khỏi bản local.',
    danger: 'danger',
    warning: 'Xóa nhánh trên remote ảnh hưởng cả team.',
  },
  {
    id: 'branch-upstream',
    group: 'branch',
    want: 'Tôi muốn đẩy nhánh mới lên remote và gắn upstream',
    commands: ['git push -u <remote> <branch>', 'git branch --set-upstream-to=<remote>/<branch>'],
    explain: 'Sau khi gắn upstream, chỉ cần git push / git pull.',
  },
  {
    id: 'branch-track',
    group: 'branch',
    want: 'Tôi muốn lấy một nhánh có sẵn trên remote về làm việc',
    commands: ['git fetch <remote>', 'git switch <branch>'],
    explain: 'Nếu <branch> chỉ tồn tại trên remote, switch sẽ tự tạo nhánh local theo dõi nó.',
  },

  // ---------- Merge / Rebase / Cherry-pick / Stash ----------
  {
    id: 'merge',
    group: 'integrate',
    want: 'Tôi muốn merge một nhánh vào nhánh hiện tại',
    commands: ['git merge <branch>', 'git merge --no-ff <branch>', 'git merge --squash <branch>'],
    explain: '--no-ff luôn tạo merge commit. --squash gộp mọi commit thành thay đổi chờ commit (không tạo merge commit).',
  },
  {
    id: 'conflict',
    group: 'integrate',
    want: 'Tôi muốn xử lý xung đột (conflict)',
    commands: ['git status', 'git add <file>', 'git merge --continue'],
    explain: 'Sửa các đoạn <<<<<<< ======= >>>>>>> trong file, git add file đã sửa, rồi continue (hoặc git rebase --continue, git commit).',
  },
  {
    id: 'conflict-side',
    group: 'integrate',
    want: 'Tôi muốn chọn hẳn một phía khi xung đột file',
    commands: ['git checkout --ours <file>', 'git checkout --theirs <file>'],
    explain: 'Khi merge: ours là nhánh hiện tại, theirs là nhánh được merge vào. Khi rebase thì ngược lại.',
    danger: 'caution',
    warning: 'Bỏ hoàn toàn thay đổi của phía còn lại trong file đó.',
  },
  {
    id: 'rebase',
    group: 'integrate',
    want: 'Tôi muốn rebase nhánh hiện tại lên nhánh khác',
    commands: ['git rebase <branch>', 'git rebase --continue', 'git rebase --abort'],
    explain: 'Đặt các commit của bạn lên trên đầu <branch> để lịch sử thẳng hàng.',
    danger: 'caution',
    warning: 'Viết lại lịch sử: đừng rebase nhánh đã được người khác dùng.',
  },
  {
    id: 'rebase-i',
    group: 'integrate',
    want: 'Tôi muốn gộp (squash), sửa, đổi thứ tự vài commit gần nhất',
    commands: ['git rebase -i HEAD~<n>', 'git rebase -i --autosquash <branch>'],
    explain: 'Mở danh sách commit; đổi pick thành squash/fixup/reword/drop. Dùng với git commit --fixup <commit> + --autosquash.',
    danger: 'caution',
    warning: 'Viết lại lịch sử. Nếu đã push cần git push --force-with-lease.',
  },
  {
    id: 'cherry-pick',
    group: 'integrate',
    want: 'Tôi muốn lấy riêng một commit từ nhánh khác',
    commands: ['git cherry-pick <commit>', 'git cherry-pick <commit> -x', 'git cherry-pick A..B'],
    explain: '-x ghi chú commit gốc vào message. Dạng A..B lấy dải commit (không gồm A).',
  },
  {
    id: 'stash',
    group: 'integrate',
    want: 'Tôi muốn cất tạm thay đổi đang làm dở',
    commands: ['git stash push -m <message>', 'git stash push -u', 'git stash push <file>'],
    explain: '-u gồm cả file chưa theo dõi (untracked). Có thể chỉ stash một file.',
  },
  {
    id: 'stash-apply',
    group: 'integrate',
    want: 'Tôi muốn lấy lại thay đổi đã stash',
    commands: ['git stash list', 'git stash pop', 'git stash apply stash@{0}', 'git stash show -p stash@{0}'],
    explain: 'pop áp dụng rồi xóa stash. apply giữ lại stash. show -p xem nội dung.',
  },
  {
    id: 'stash-drop',
    group: 'integrate',
    want: 'Tôi muốn xóa stash',
    commands: ['git stash drop stash@{0}', 'git stash clear'],
    explain: 'drop xóa một mục; clear xóa tất cả.',
    danger: 'danger',
    warning: 'Stash đã xóa rất khó khôi phục.',
  },

  // ---------- Remote, push & pull ----------
  {
    id: 'remote-list',
    group: 'remote',
    want: 'Tôi muốn xem và quản lý remote',
    commands: ['git remote -v', 'git remote add <remote> <url>', 'git remote set-url <remote> <url>', 'git remote remove <remote>'],
    explain: 'remote add thêm kết nối mới, set-url đổi địa chỉ.',
  },
  {
    id: 'fetch',
    group: 'remote',
    want: 'Tôi muốn lấy cập nhật từ remote mà chưa gộp vào nhánh',
    commands: ['git fetch <remote>', 'git fetch --all --prune'],
    explain: 'Chỉ cập nhật các nhánh remote-tracking. --prune xóa tham chiếu nhánh đã bị xóa trên remote.',
  },
  {
    id: 'pull',
    group: 'remote',
    want: 'Tôi muốn kéo và gộp thay đổi mới từ remote',
    commands: ['git pull', 'git pull --rebase <remote> <branch>', 'git pull --ff-only'],
    explain: 'pull = fetch + merge (hoặc rebase). --ff-only từ chối nếu cần tạo merge commit.',
  },
  {
    id: 'push',
    group: 'remote',
    want: 'Tôi muốn đẩy commit lên remote',
    commands: ['git push', 'git push <remote> <branch>', 'git push --tags'],
    explain: 'Lần đầu với nhánh mới, thêm -u để gắn upstream.',
  },
  {
    id: 'force-with-lease',
    group: 'remote',
    want: 'Tôi muốn force push sau khi rebase/amend (an toàn hơn --force)',
    commands: ['git push --force-with-lease', 'git push --force-with-lease <remote> <branch>'],
    explain: 'Chỉ ghi đè nếu remote chưa có commit mới mà bạn chưa thấy, tránh vô tình xóa việc của đồng đội.',
    danger: 'danger',
    warning: 'Ghi đè lịch sử trên remote. Không dùng cho nhánh chung như main nếu chưa thống nhất với team.',
  },
  {
    id: 'force-push',
    group: 'remote',
    want: 'Tôi muốn ép remote theo đúng nhánh local của tôi',
    commands: ['git push --force <remote> <branch>'],
    explain: 'Ghi đè không điều kiện. Ưu tiên --force-with-lease.',
    danger: 'danger',
    warning: 'Có thể xóa commit của người khác trên remote vĩnh viễn.',
  },
  {
    id: 'sync-fork',
    group: 'remote',
    want: 'Tôi muốn đồng bộ fork với repo gốc (upstream)',
    commands: ['git remote add upstream <url>', 'git fetch upstream', 'git rebase upstream/<branch>'],
    explain: 'Thêm remote upstream một lần, sau đó fetch và rebase (hoặc merge) nhánh chính của repo gốc.',
  },
  {
    id: 'reset-to-remote',
    group: 'remote',
    want: 'Tôi muốn đưa nhánh local về giống hệt remote',
    commands: ['git fetch <remote>', 'git reset --hard <remote>/<branch>'],
    explain: 'Bỏ mọi commit và thay đổi local khác với remote.',
    danger: 'danger',
    warning: 'Mất commit local chưa push và thay đổi chưa commit.',
  },

  // ---------- Tag ----------
  {
    id: 'tag-create',
    group: 'tag',
    want: 'Tôi muốn đánh dấu một phiên bản (tag)',
    commands: ['git tag <tag>', 'git tag -a <tag> -m <message>', 'git tag -a <tag> <commit>'],
    explain: 'Tag có chú thích (-a) nên dùng cho bản phát hành. Có thể tag một commit cũ.',
  },
  {
    id: 'tag-push',
    group: 'tag',
    want: 'Tôi muốn đẩy tag lên remote',
    commands: ['git push <remote> <tag>', 'git push <remote> --tags'],
    explain: 'Tag không tự được push cùng nhánh.',
  },
  {
    id: 'tag-delete',
    group: 'tag',
    want: 'Tôi muốn xóa tag',
    commands: ['git tag -d <tag>', 'git push <remote> --delete <tag>'],
    explain: 'Lệnh đầu xóa local, lệnh sau xóa trên remote.',
    danger: 'caution',
    warning: 'Xóa tag trên remote ảnh hưởng người đã dùng tag đó.',
  },
  {
    id: 'tag-list',
    group: 'tag',
    want: 'Tôi muốn xem danh sách tag và checkout theo tag',
    commands: ['git tag -l "v1.*"', 'git show <tag>', 'git switch --detach <tag>'],
    explain: 'Checkout theo tag đưa bạn vào trạng thái detached HEAD; tạo nhánh nếu muốn làm việc tiếp.',
  },

  // ---------- Xem lịch sử ----------
  {
    id: 'log-oneline',
    group: 'history',
    want: 'Tôi muốn xem lịch sử gọn, dạng đồ thị',
    commands: ['git log --oneline', 'git log --oneline --graph --decorate --all', 'git log -n <n>'],
    explain: 'Mỗi commit một dòng; --graph vẽ cây nhánh; -n giới hạn số commit.',
  },
  {
    id: 'log-format',
    group: 'history',
    want: 'Tôi muốn định dạng log theo ý mình',
    commands: [
      "git log --pretty=format:'%h %an %ad %s' --date=short",
      "git log --pretty=format:'%C(yellow)%h%Creset %C(green)%ad%Creset %s %C(bold blue)<%an>%Creset' --date=relative",
    ],
    explain: '%h hash ngắn, %an tác giả, %ad ngày, %s tiêu đề, %C... đặt màu.',
  },
  {
    id: 'log-filter',
    group: 'history',
    want: 'Tôi muốn lọc log theo tác giả, thời gian hoặc nội dung',
    commands: [
      'git log --author=<name>',
      'git log --since="2 weeks ago" --until=yesterday',
      'git log --grep=<message>',
      'git log -S<message>',
    ],
    explain: '--grep tìm trong message; -S tìm commit thêm/bớt đúng chuỗi trong code (pickaxe).',
  },
  {
    id: 'log-file',
    group: 'history',
    want: 'Tôi muốn xem lịch sử của một file',
    commands: ['git log --follow -p -- <file>', 'git log --oneline -- <path>'],
    explain: '--follow theo dõi cả khi file bị đổi tên; -p hiện nội dung thay đổi.',
  },
  {
    id: 'blame',
    group: 'history',
    want: 'Tôi muốn biết ai sửa từng dòng của file',
    commands: ['git blame <file>', 'git blame -L 10,20 <file>', 'git blame -w -C <file>'],
    explain: '-L giới hạn dòng. -w bỏ qua khoảng trắng, -C phát hiện code được chuyển từ file khác.',
  },
  {
    id: 'show',
    group: 'history',
    want: 'Tôi muốn xem chi tiết một commit',
    commands: ['git show <commit>', 'git show --stat <commit>', 'git show <commit>:<file>'],
    explain: 'Dạng cuối in nội dung file tại commit đó.',
  },
  {
    id: 'diff-compare',
    group: 'history',
    want: 'Tôi muốn so sánh hai nhánh hoặc hai commit',
    commands: ['git diff <branch>..<newbranch>', 'git diff <commit> HEAD -- <file>', 'git diff <branch>...HEAD'],
    explain: 'Ba chấm (...) so với điểm tách chung, chỉ hiện thay đổi phía bên phải.',
  },
  {
    id: 'bisect',
    group: 'history',
    want: 'Tôi muốn tìm commit gây ra lỗi (bisect)',
    commands: ['git bisect start', 'git bisect bad', 'git bisect good <commit>', 'git bisect reset'],
    explain: 'Git tìm nhị phân giữa commit tốt và xấu; sau mỗi lần test, gõ good hoặc bad. Kết thúc bằng reset.',
  },
  {
    id: 'which-branch',
    group: 'history',
    want: 'Tôi muốn biết commit này nằm ở nhánh nào, nhánh nào đã merge',
    commands: ['git branch --contains <commit>', 'git branch --merged', 'git branch --no-merged'],
    explain: '--merged liệt kê nhánh đã gộp vào nhánh hiện tại (có thể xóa an toàn).',
  },
  {
    id: 'shortlog',
    group: 'history',
    want: 'Tôi muốn thống kê số commit theo tác giả',
    commands: ['git shortlog -sn --no-merges'],
    explain: 'Sắp xếp theo số commit giảm dần.',
  },

  // ---------- Dọn dẹp ----------
  {
    id: 'clean',
    group: 'cleanup',
    want: 'Tôi muốn xóa các file chưa được theo dõi (untracked)',
    commands: ['git clean -n -d', 'git clean -fd', 'git clean -fdx'],
    explain: 'Luôn chạy -n (dry-run) trước để xem sẽ xóa gì. -x xóa cả file bị .gitignore.',
    danger: 'danger',
    warning: 'File bị xóa không vào thùng rác và không khôi phục được. -x còn xóa cả file cấu hình bị ignore (.env, node_modules...).',
  },
  {
    id: 'gc',
    group: 'cleanup',
    want: 'Tôi muốn dọn và nén repo cho nhẹ',
    commands: ['git gc', 'git gc --aggressive --prune=now', 'git count-objects -vH'],
    explain: 'count-objects xem dung lượng. gc --prune=now xóa ngay object mồ côi.',
    danger: 'caution',
    warning: '--prune=now khiến các commit chỉ còn trong reflog không cứu được nữa.',
  },
  {
    id: 'prune-branches',
    group: 'cleanup',
    want: 'Tôi muốn xóa các nhánh local đã merge',
    commands: ['git branch --merged | grep -v "\\*" | xargs -n 1 git branch -d'],
    explain: 'Xóa mọi nhánh đã merge vào nhánh hiện tại. Kiểm tra danh sách bằng git branch --merged trước.',
    danger: 'caution',
    warning: 'Có thể xóa cả nhánh bạn muốn giữ (như develop). Xem trước danh sách.',
  },
  {
    id: 'big-files',
    group: 'cleanup',
    want: 'Tôi muốn xóa file lớn hoặc bí mật đã lỡ commit khỏi toàn bộ lịch sử',
    commands: ['git filter-repo --path <file> --invert-paths', 'git push --force-with-lease <remote> --all'],
    explain: 'Dùng công cụ git-filter-repo (cài riêng, thay thế filter-branch đã lỗi thời). Sau đó mọi người phải clone lại. Nếu lộ mật khẩu/khóa, hãy đổi (revoke) ngay vì nó đã lộ.',
    danger: 'danger',
    warning: 'Viết lại TOÀN BỘ lịch sử, đổi mọi hash commit. Hãy sao lưu repo trước và báo cả team.',
  },
  {
    id: 'untrack-ignored',
    group: 'cleanup',
    want: 'Tôi muốn Git ngừng theo dõi file đã commit nhưng nay nằm trong .gitignore',
    commands: ['git rm -r --cached <path>', 'git commit -m <message>'],
    explain: 'Giữ file trên đĩa, chỉ xóa khỏi chỉ mục Git.',
  },

  // ---------- Submodule ----------
  {
    id: 'submodule-add',
    group: 'submodule',
    want: 'Tôi muốn thêm một repo khác làm submodule',
    commands: ['git submodule add <url> <path>'],
    explain: 'Tạo file .gitmodules và ghim submodule ở một commit cụ thể.',
  },
  {
    id: 'submodule-clone',
    group: 'submodule',
    want: 'Tôi muốn clone repo có submodule / khởi tạo submodule',
    commands: ['git clone --recurse-submodules <url>', 'git submodule update --init --recursive'],
    explain: 'Lệnh sau dùng khi bạn đã clone mà quên --recurse-submodules.',
  },
  {
    id: 'submodule-update',
    group: 'submodule',
    want: 'Tôi muốn cập nhật submodule lên bản mới nhất',
    commands: ['git submodule update --remote --merge', 'git submodule status'],
    explain: 'Sau khi cập nhật, commit con trỏ submodule mới ở repo cha.',
  },
  {
    id: 'submodule-remove',
    group: 'submodule',
    want: 'Tôi muốn gỡ một submodule',
    commands: ['git submodule deinit -f <path>', 'git rm -f <path>', 'rm -rf .git/modules/<path>'],
    explain: 'Gỡ đăng ký, xóa khỏi chỉ mục rồi dọn dữ liệu trong .git/modules.',
    danger: 'danger',
    warning: 'Xóa thư mục submodule và dữ liệu git của nó; thay đổi chưa push trong submodule sẽ mất.',
  },

  // ---------- Worktree ----------
  {
    id: 'worktree-add',
    group: 'worktree',
    want: 'Tôi muốn làm việc trên hai nhánh cùng lúc ở hai thư mục',
    commands: ['git worktree add <path> <branch>', 'git worktree add -b <newbranch> <path>'],
    explain: 'Tạo thư mục làm việc thứ hai dùng chung kho .git, không cần clone lại hay stash.',
  },
  {
    id: 'worktree-list',
    group: 'worktree',
    want: 'Tôi muốn xem và xóa worktree',
    commands: ['git worktree list', 'git worktree remove <path>', 'git worktree prune'],
    explain: 'prune dọn thông tin worktree có thư mục đã bị xóa thủ công.',
    danger: 'caution',
    warning: 'worktree remove xóa thư mục; thay đổi chưa commit trong đó sẽ mất.',
  },
];
