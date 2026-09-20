@echo off
chcp 65001 >nul
title 重新登录 Cloudflare（部署用）
cd /d "%~dp0"

echo ================================================
echo   Cloudflare 重新登录
echo ================================================
echo.
echo   接下来浏览器会自动弹出授权页面：
echo     - 若提示登录，先登录你的 Cloudflare 账号
echo     - 页面底部点击 [ Allow ] 按钮
echo   看到 "Successfully logged in" 就完成了。
echo.
echo   按任意键开始...
pause >nul

call npx wrangler login

echo.
echo ================================================
echo   如果上面显示 Successfully logged in，说明已成功
echo   回到对话里说一声「登好了」，我会立刻部署
echo ================================================
pause
