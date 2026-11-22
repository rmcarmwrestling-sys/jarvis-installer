package com.jarvis.android

import android.content.Context
import dev.ffmpegkit.llama.Llama
import dev.ffmpegkit.llama.LlamaConfig
import dev.ffmpegkit.llama.LlamaModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Small on-device language-model bridge. The WebView talks to this class via
 * MainActivity's Javascript interface; llama.cpp does all inference locally.
 */
class LocalLlmBridge(
    private val context: Context,
    private val callback: Callback,
) {
    interface Callback {
        fun onEvent(requestId: String, payload: String)
    }

    companion object {
        const val MODEL_ID = "qwen2.5-0.5b-instruct-q4_k_m"
        private const val MODEL_URL = "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf?download=true"
    }

    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val modelFile: File = File(File(context.filesDir, "models"), "$MODEL_ID.gguf")
    private var loadedModel: LlamaModel? = null

    fun status(): String {
        val ready = modelFile.exists() && modelFile.length() > 10_000_000L
        return JSONObject()
            .put("available", ready)
            .put("model", MODEL_ID)
            .put("bytes", if (modelFile.exists()) modelFile.length() else 0)
            .put("expectedBytes", 491_400_032L)
            .toString()
    }

    fun download(requestId: String) {
        executor.execute {
            try {
                downloadFile(requestId)
                emit(requestId, JSONObject().put("state", "ready").put("model", MODEL_ID))
            } catch (error: Exception) {
                emit(requestId, JSONObject().put("state", "error").put("message", error.message ?: "No se pudo descargar el modelo local."))
            }
        }
    }

    fun chat(requestId: String, messagesJson: String) {
        executor.execute {
            try {
                if (!modelFile.exists() || modelFile.length() < 10_000_000L) {
                    downloadFile(requestId)
                }
                val model = ensureLoaded()
                val parsed = buildPrompt(messagesJson)
                val result = runBlocking(Dispatchers.Default) {
                    Llama.complete(
                        model = model,
                        prompt = parsed.first,
                        systemPrompt = parsed.second,
                        maxTokens = 512,
                    )
                }
                emit(requestId, JSONObject().put("state", "done").put("text", result.text).put("model", MODEL_ID))
            } catch (error: Exception) {
                emit(requestId, JSONObject().put("state", "error").put("message", error.message ?: "El modelo local no pudo responder."))
            }
        }
    }

    fun close() {
        executor.execute {
            loadedModel?.let { model ->
                try {
                    runBlocking(Dispatchers.Default) {
                        Llama.releaseModel(model)
                    }
                } catch (_: Exception) { }
            }
            loadedModel = null
            executor.shutdown()
        }
    }

    private fun ensureLoaded(): LlamaModel {
        loadedModel?.let { return it }
        val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 6)
        val model = runBlocking(Dispatchers.Default) {
            Llama.loadModel(
                modelPath = modelFile.absolutePath,
                config = LlamaConfig(contextSize = 2048, threads = threads),
            )
        }
        loadedModel = model
        return model
    }

    private fun downloadFile(requestId: String) {
        if (modelFile.exists() && modelFile.length() > 10_000_000L) return
        modelFile.parentFile?.mkdirs()
        val partial = File(modelFile.parentFile, "${modelFile.name}.part")
        val connection = (URL(MODEL_URL).openConnection() as HttpURLConnection).apply {
            connectTimeout = 30_000
            readTimeout = 60_000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "Jarvis Android local model")
        }
        try {
            connection.connect()
            if (connection.responseCode !in 200..299) throw IllegalStateException("El servidor del modelo respondió ${connection.responseCode}.")
            val total = connection.contentLengthLong
            var received = 0L
            connection.inputStream.use { input ->
                partial.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var lastProgress = -1
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        received += count
                        val progress = if (total > 0) ((received * 100L) / total).toInt() else -1
                        if (progress != lastProgress) {
                            lastProgress = progress
                            emit(requestId, JSONObject().put("state", "downloading").put("progress", progress).put("received", received).put("total", total))
                        }
                    }
                }
            }
            if (partial.length() < 10_000_000L) throw IllegalStateException("La descarga del modelo quedó incompleta.")
            if (modelFile.exists()) modelFile.delete()
            if (!partial.renameTo(modelFile)) throw IllegalStateException("No se pudo guardar el modelo local.")
        } finally {
            connection.disconnect()
        }
    }

    private fun buildPrompt(messagesJson: String): Pair<String, String> {
        val array = JSONArray(messagesJson)
        val system = StringBuilder("Eres Jarvis, un asistente personal útil. Responde en español salvo que te pidan otro idioma. No afirmes haber realizado acciones del dispositivo que no puedes ejecutar. Sé claro y conciso.")
        val prompt = StringBuilder()
        for (index in 0 until array.length()) {
            val message = array.optJSONObject(index) ?: continue
            val role = message.optString("role", "user")
            val content = when (val raw = message.opt("content")) {
                is String -> raw
                is JSONArray -> buildString {
                    for (partIndex in 0 until raw.length()) {
                        val part = raw.optJSONObject(partIndex)
                        if (part?.optString("type") == "text") append(part.optString("text")).append('\n')
                    }
                }
                else -> ""
            }.trim()
            if (content.isEmpty()) continue
            if (role == "system") system.append('\n').append(content)
            else prompt.append(if (role == "assistant") "Jarvis: " else "Usuario: ").append(content).append("\n")
        }
        prompt.append("Jarvis:")
        return Pair(prompt.toString(), system.toString())
    }

    private fun emit(requestId: String, payload: JSONObject) {
        callback.onEvent(requestId, payload.toString())
    }
}
