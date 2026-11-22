package com.gandreini.nod.network

import com.facebook.react.modules.network.OkHttpClientProvider
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.delay

class NodNetworkModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NodNetwork")

    AsyncFunction("reset") Coroutine { host: String ->
      val client = OkHttpClientProvider.getOkHttpClient()
      val calls = client.dispatcher.queuedCalls() + client.dispatcher.runningCalls()
      calls.filter { it.request().url.host == host }.forEach { it.cancel() }
      client.connectionPool.evictAll()
      delay(250)
      client.connectionPool.evictAll()
    }
  }
}
