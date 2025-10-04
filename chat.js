document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("message-input");
  const messages = document.getElementById("messages");

  // 防止重复监听
  if (!form.dataset.bound) {
    form.dataset.bound = "true";

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      // 在界面显示
      const msgDiv = document.createElement("div");
      msgDiv.className = "message self";
      msgDiv.innerText = "我：" + text;
      messages.appendChild(msgDiv);

      // 上传到 Supabase
      try {
        const { error } = await supabase.from("messages").insert([
          {
            room_id: ROOM_ID,
            author: "我",
            content: text,
          },
        ]);
        if (error) console.error("上传失败：", error.message);
      } catch (err) {
        console.error("网络错误：", err);
      }

      input.value = "";
    });
  }
});
